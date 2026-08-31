import React, {useEffect, useRef, useState} from 'react';
import {CONTENT_FONT, GUI_THEME, TEXT} from '../lib/gui-theme';
import {
	GuiContributor,
	GuiUser,
	GuiIssue,
	GuiTag,
	GuiComment,
	GuiAttachment,
	GuiRefCommitEntry,
	GuiIssueHistoryEntry,
} from '../lib/gui-state.model';
import {
	Aside,
	ASIDE_PADDING,
	readStoredAsideWidth,
	STACKED_DIFF_WIDTH,
} from './Aside';
import {Button} from './Button';
import {ManageContributorsModal} from './ManageContributorsModal';
import {ManageTagsModal} from './ManageTagsModal';
import {CopyRef} from './CopyRef';
import {FormHeader} from './FormHeader';
import {FullscreenToggleButton} from './FullscreenToggleButton';
import {PanelDockMenu} from './PanelDockMenu';
import {IconCollapseLane} from './IconCollapseLane';
import {IconExpandLane} from './IconExpandLane';
import {
	ActionRow,
	AddRow,
	ChipRow,
	Empty,
	Input,
	Textarea,
} from './FormPrimitives';
import {AttachmentUploadStatus, IssueAttachments} from './IssueAttachments';
import {CommentBody, IssueComments} from './IssueComments';
import {
	CommitDiffState,
	CommitFocus,
	DiffLocation,
	FileTicketParams,
	IssueCommits,
	parseDiffCommentMeta,
} from './IssueCommits';
import {MarkdownContent} from './MarkdownContent';
import {Section} from './Section';
import {Tabs, TabItem} from './Tabs';
import {IssueHistory} from './IssueHistory';
import {formatAbsolute, timeAgo} from '../lib/gui-format.helper';
import {usePersistedFlag} from '../lib/scrubber';
import {AsideDock} from '../lib/aside-dock';
import {MAX_DESCRIPTION_LENGTH} from '../../../lib/utils/text.limits.js';
import {useImageInsert} from '../lib/image-insert';
import {AddImageButton} from './AddImageButton';

type IssueDetailsTab = 'overview' | 'comments' | 'history' | 'code';

// Fullscreen on a panel at least this wide drops the tabs and lays the four
// panes out side by side. Below it, four lanes would be too narrow to read,
// so fullscreen keeps the tabbed layout.
export const LANE_VIEW_WIDTH = 1400;
const LANE_GAP = 20;
const LANE_COUNT = 4;
// Commits holds diffs, so it takes half the row; the other three share the rest.
const LANE_SHARES = {
	overview: 1,
	comments: 1,
	commits: 3,
	log: 1,
} as const;
type LaneKey = keyof typeof LANE_SHARES;
const LANE_KEYS = Object.keys(LANE_SHARES) as LaneKey[];

// Wide enough for the upright label and a comfortable click target.
const COLLAPSED_LANE_WIDTH = 28;
// Long enough to read as a movement, short enough not to be waited on.
const LANE_COLLAPSE_MS = 180;

const LANE_LABEL_STYLE = {
	color: GUI_THEME.secondary,
	fontSize: TEXT.label,
	textTransform: 'uppercase',
	letterSpacing: '0.08em',
} as const;

// Same footprint and hover as FullscreenToggleButton, which is the other
// icon-only control in this panel.
const LaneIconButton = ({
	label,
	icon,
	onClick,
	style,
	children,
}: {
	label: string;
	icon: React.ReactNode;
	onClick: () => void;
	style?: React.CSSProperties;
	children?: React.ReactNode;
}) => (
	<button
		type="button"
		aria-label={label}
		title={label}
		onClick={onClick}
		style={{
			display: 'inline-flex',
			alignItems: 'center',
			flexShrink: 0,
			background: 'transparent',
			border: 'none',
			padding: 4,
			borderRadius: 4,
			cursor: 'pointer',
			color: GUI_THEME.dim,
			fontFamily: 'inherit',
			transition: 'color 120ms ease, background 120ms ease',
			...style,
		}}
		onMouseEnter={event => {
			event.currentTarget.style.background = 'rgba(255,255,255,0.04)';
			event.currentTarget.style.color = GUI_THEME.accent;
		}}
		onMouseLeave={event => {
			event.currentTarget.style.background = 'transparent';
			event.currentTarget.style.color = GUI_THEME.dim;
		}}
	>
		{icon}
		{children}
	</button>
);

/**
 * One column of the lanes view, collapsible to a rail so the lanes that stay
 * open — the diff, usually — get the width back.
 *
 * The toggles are labelled "Collapse …"/"Expand …" rather than by the lane
 * name: `fullscreen-lanes.pw.ts` proves the tabs are gone in this view by
 * counting buttons named after a lane, and a header button named "Comments"
 * would read as a tab to it.
 */
const Lane = ({
	title,
	count,
	collapsed,
	canCollapse,
	onToggle,
	children,
}: {
	title: string;
	count?: number;
	collapsed: boolean;
	canCollapse: boolean;
	onToggle: () => void;
	children: React.ReactNode;
}) => {
	const label = `${title}${typeof count === 'number' ? ` (${count})` : ''}`;
	const testId = `lane-${title.toLowerCase()}`;

	if (collapsed) {
		return (
			<div
				data-testid={testId}
				data-collapsed="true"
				style={{display: 'flex', minHeight: 0, overflow: 'hidden'}}
			>
				{/* The whole rail is the target here, unlike the open header: at 28px
				    there is no room to aim at anything smaller, and re-opening a lane
				    by accident costs nothing. */}
				<LaneIconButton
					label={`Expand ${title}`}
					onClick={onToggle}
					icon={<IconExpandLane size={12} />}
					style={{
						flex: 1,
						flexDirection: 'column',
						gap: 8,
						alignItems: 'center',
						justifyContent: 'flex-start',
						paddingTop: 8,
						borderRadius: 0,
						borderRight: `1px solid ${GUI_THEME.line}`,
					}}
				>
					{/* Bottom-to-top, so the label reads upward from the panel floor
					    rather than upside down. */}
					<span
						style={{
							...LANE_LABEL_STYLE,
							writingMode: 'vertical-rl',
							transform: 'rotate(180deg)',
							whiteSpace: 'nowrap',
						}}
					>
						{label}
					</span>
				</LaneIconButton>
			</div>
		);
	}

	return (
		<div
			data-testid={testId}
			data-collapsed="false"
			style={{display: 'flex', flexDirection: 'column', minHeight: 0}}
		>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: 8,
					paddingBottom: 6,
					marginBottom: 14,
					borderBottom: `1px solid ${GUI_THEME.line}`,
				}}
			>
				<span style={{...LANE_LABEL_STYLE, minWidth: 0}}>{label}</span>

				{/* Only the button collapses the lane. The header used to do it
				    wholesale, which was far too easy to trigger by aiming at nothing
				    in particular. The last open lane has nowhere to collapse to, so
				    it shows no control at all. */}
				{canCollapse && (
					<LaneIconButton
						label={`Collapse ${title}`}
						onClick={onToggle}
						icon={<IconCollapseLane size={12} />}
					/>
				)}
			</div>
			<div style={{flex: 1, minHeight: 0, overflowY: 'auto'}}>{children}</div>
		</div>
	);
};

export const IssueDetails = ({
	dock,
	onDock,
	whoAmI,
	comments,
	history,
	onHoverHistoryEvent,
	activeTab,
	onChangeTab,
	issue,
	onClose,
	onEditTitle,
	onEditDescription,
	onAddTag,
	onRemoveTag,
	onAddAssignee,
	onAddExternalAssignee,
	onRemoveContributor,
	onDeleteTag,
	onRemoveAssignee,
	onCloseIssue,
	onReopenIssue,
	onAddComment,
	onDeleteComment,
	onEditComment,
	onFileTicket,
	onOpenDiffLocation,
	diffFocus,
	attachments,
	attachmentUploadStatus,
	onUploadAttachments,
	onDeleteAttachment,
	commits,
	commitsLoading,
	commitsError,
	commitDiffsBySha,
	onLoadCommitDiff,
	knownTags: tags,
	knownAssignees: assignees,
	onOpenAssigneePicker,
}: {
	dock: AsideDock;
	onDock: (next: AsideDock) => void;
	whoAmI: GuiUser;
	issue: GuiIssue | null;
	comments: GuiComment[];
	history: GuiIssueHistoryEntry[];
	onHoverHistoryEvent: (eventId: string | null) => void;
	onClose: () => void;
	activeTab: IssueDetailsTab;
	onChangeTab: (tab: IssueDetailsTab) => void;
	onEditTitle: (issueId: string, title: string) => void;
	onEditDescription: (issueId: string, description: string) => void;
	onAddTag: (issueId: string, tagName: string) => void;
	onRemoveTag: (issueId: string, tagId: string) => void;
	onAddAssignee: (issueId: string, assigneeId: string) => void;
	onAddExternalAssignee: (issueId: string, assigneeName: string) => void;
	onRemoveContributor: (contributorId: string) => void;
	onDeleteTag: (tagId: string) => void;
	onRemoveAssignee: (issueId: string, assigneeId: string) => void;
	onCloseIssue: (issueId: string) => void;
	onReopenIssue: (issueId: string) => void;
	onAddComment?: (issueId: string, body: string) => void;
	onDeleteComment?: (issueId: string, commentId: string) => void;
	onEditComment?: (issueId: string, commentId: string, body: string) => void;
	onFileTicket?: (
		originIssueId: string,
		originRef: string,
		params: FileTicketParams,
	) => void;
	// Following a comment's permalink: the caller puts it in the URL, and
	// hands back where it currently points so the Commits tab can open there.
	onOpenDiffLocation?: (location: DiffLocation) => void;
	diffFocus?: CommitFocus | null;
	attachments: GuiAttachment[];
	attachmentUploadStatus: AttachmentUploadStatus;
	// Resolves to one markdown reference per stored file, so a composer can
	// leave them at the cursor.
	onUploadAttachments?: (issueId: string, files: File[]) => Promise<string[]>;
	onDeleteAttachment?: (issueId: string, attachmentId: string) => void;
	commits: GuiRefCommitEntry[];
	commitsLoading: boolean;
	commitsError: string | null;
	commitDiffsBySha: Record<string, CommitDiffState>;
	onLoadCommitDiff: (sha: string) => void;
	knownTags: GuiTag[];
	knownAssignees: GuiContributor[];
	// Fired when the picker opens, so the caller can fetch the list only then.
	onOpenAssigneePicker: () => void;
}) => {
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [tagName, setTagName] = useState('');
	const [assigneeName, setAssigneeName] = useState('');
	const [managingContributors, setManagingContributors] = useState(false);
	const [managingTags, setManagingTags] = useState(false);
	const [editingTitle, setEditingTitle] = useState(false);
	const [editingDescription, setEditingDescription] = useState(false);
	const [addingTag, setAddingTag] = useState(false);
	const [addingAssignee, setAddingAssignee] = useState(false);
	// Tracks the resizable Aside's live width so the Code tab can pick split
	// vs. unified diffs — initialized from the same persisted value Aside
	// itself reads, so the first render already picks the right layout.
	const [panelWidth, setPanelWidth] = useState(readStoredAsideWidth);
	// Read synchronously rather than in an effect: entering fullscreen has to
	// lay the lanes out in the same commit, which aside-stacking.pw.ts proves.
	const [overviewCollapsed, setOverviewCollapsed] = usePersistedFlag(
		'epiq.lane.overview.collapsed',
		false,
	);
	const [commentsCollapsed, setCommentsCollapsed] = usePersistedFlag(
		'epiq.lane.comments.collapsed',
		false,
	);
	const [commitsCollapsed, setCommitsCollapsed] = usePersistedFlag(
		'epiq.lane.commits.collapsed',
		false,
	);
	const [logCollapsed, setLogCollapsed] = usePersistedFlag(
		'epiq.lane.log.collapsed',
		false,
	);
	const laneCollapsed: Record<LaneKey, boolean> = {
		overview: overviewCollapsed,
		comments: commentsCollapsed,
		commits: commitsCollapsed,
		log: logCollapsed,
	};
	const setLaneCollapsed: Record<LaneKey, (next: boolean) => void> = {
		overview: setOverviewCollapsed,
		comments: setCommentsCollapsed,
		commits: setCommitsCollapsed,
		log: setLogCollapsed,
	};
	// Collapsing the last one would leave four rails and nothing to read.
	const openLaneCount = LANE_KEYS.filter(key => !laneCollapsed[key]).length;
	const panelRef = useRef<HTMLElement | null>(null);
	const titleTextareaRef = useRef<HTMLTextAreaElement | null>(null);
	const descriptionRef = useRef<HTMLTextAreaElement | null>(null);

	const resizeTitleTextarea = () => {
		const el = titleTextareaRef.current;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = `${el.scrollHeight}px`;
	};

	useEffect(() => {
		if (editingTitle) resizeTitleTextarea();
	}, [editingTitle]);

	useEffect(() => {
		setTitle(issue?.title ?? '');
		setDescription(issue?.description ?? '');
		setTagName('');
		setAssigneeName('');
		setEditingTitle(false);
		setEditingDescription(false);
		setAddingTag(false);
		setAddingAssignee(false);
	}, [issue?.id, issue?.title, issue?.description]);

	const disabled = !issue || issue.readonly;

	// Below `disabled`, which it reads: a readonly ticket takes no images.
	const descriptionImages = useImageInsert({
		issueId: issue?.id ?? '',
		setValue: setDescription,
		textareaRef: descriptionRef,
		onUploadImages: disabled ? undefined : onUploadAttachments,
	});

	// No count until the list has arrived: 0 would misread as "no commits".
	const commitsCount =
		commitsLoading || commitsError ? undefined : commits.length;

	const tabs: TabItem<IssueDetailsTab>[] = [
		{id: 'overview', label: 'Overview'},
		{id: 'comments', label: 'Comments', count: comments.length},
		{id: 'code', label: 'Commits', count: commitsCount},
		{id: 'history', label: 'Log', count: history.length},
	];

	const saveTitle = () => {
		if (disabled || !issue) return setEditingTitle(false);

		const nextTitle = title.trim();

		if (!nextTitle) {
			setTitle(issue.title);
			return setEditingTitle(false);
		}

		if (nextTitle !== issue.title) {
			onEditTitle(issue.id, nextTitle);
		}

		setEditingTitle(false);
	};

	const saveDescription = () => {
		if (disabled || !issue) return setEditingDescription(false);

		if (description !== issue.description) {
			onEditDescription(issue.id, description);
		}

		setEditingDescription(false);
	};

	const cancelTitle = () => {
		setTitle(issue?.title ?? '');
		setEditingTitle(false);
	};

	const cancelDescription = () => {
		setDescription(issue?.description ?? '');
		setEditingDescription(false);
	};

	const addTag = () => {
		if (disabled || !issue || !tagName.trim()) return;

		onAddTag(issue.id, tagName.trim());
		setTagName('');
		setAddingTag(false);
	};

	const addAssignee = () => {
		if (disabled || !issue || !assigneeName.trim()) return;

		onAddExternalAssignee(issue.id, assigneeName.trim());
		setAssigneeName('');
		setAddingAssignee(false);
	};

	const availableTags = tags.filter(
		tag => !issue?.tags.some(issueTag => issueTag.id === tag.id),
	);

	// You first, then board contributors, then outsiders.
	const assigneeRank = (assignee: GuiContributor): number =>
		assignee.isSelf ? 0 : assignee.hasAuthoredAnywhere ? 1 : 2;

	const availableAssignees = assignees
		.filter(
			assignee =>
				!issue?.assignees.some(
					issueAssignee => issueAssignee.id === assignee.id,
				),
		)
		// A tombstoned contributor has no name left to pick them out by.
		.filter(assignee => !assignee.isRemoved)
		.sort(
			(a, b) =>
				assigneeRank(a) - assigneeRank(b) || a.name.localeCompare(b.name),
		);

	return (
		<Aside ref={panelRef} dock={dock} onWidthChange={setPanelWidth}>
			{({isFullscreen, toggleFullscreen}) => {
				// Docked to the bottom the panel already spans the window, so it earns
				// the lanes without fullscreen. Not width alone: MAX_ASIDE_WIDTH and
				// LANE_VIEW_WIDTH are both 1400, so a side panel dragged to its limit
				// would otherwise flip into lanes on the last pixel.
				const laneView =
					(isFullscreen || dock === 'bottom') && panelWidth >= LANE_VIEW_WIDTH;

				// A collapsed lane costs a fixed rail; the rest of the width is split
				// between the lanes still open, so the diff actually receives what
				// collapsing its neighbours gave up.
				const openShares = LANE_KEYS.filter(key => !laneCollapsed[key]).reduce(
					(total, key) => total + LANE_SHARES[key],
					0,
				);
				const railTotal =
					LANE_KEYS.filter(key => laneCollapsed[key]).length *
					COLLAPSED_LANE_WIDTH;
				const laneRoom =
					panelWidth -
					ASIDE_PADDING * 2 -
					LANE_GAP * (LANE_COUNT - 1) -
					railTotal;

				// Every track in pixels, including the open ones. A track going from
				// `minmax(0, 1fr)` to `28px` changes type, and CSS cannot interpolate
				// across types — it snaps, whatever transition is set. Sizing both
				// states in the same unit is what lets the collapse animate at all.
				// Floored, so rounding can only leave a sliver of the row unused
				// rather than overflow it.
				const laneWidth = (key: LaneKey): number =>
					laneCollapsed[key]
						? COLLAPSED_LANE_WIDTH
						: Math.floor(
								(laneRoom * LANE_SHARES[key]) / Math.max(openShares, 1),
						  );

				const laneColumns = LANE_KEYS.map(key => `${laneWidth(key)}px`).join(
					' ',
				);

				// The width the Commits lane is actually given, which is what the
				// diff's split/unified choice has to follow.
				const commitsWidth = laneView ? laneWidth('commits') : panelWidth;

				const overviewPane = issue && (
					<>
						<Section
							first={true}
							title="Description"
							action={
								!issue.readonly &&
								!editingDescription && (
									<Button
										variant="ghost"
										onClick={() => setEditingDescription(true)}
									>
										edit
									</Button>
								)
							}
						>
							{editingDescription ? (
								<>
									<Textarea
										ref={descriptionRef}
										value={description}
										autoFocus
										placeholder=""
										// The primitive's default is 1500, which silently dropped
										// the tail of anything longer — and seven descriptions on
										// this board are already past it, written from the TUI or
										// over MCP where no such cap applies.
										maxLength={MAX_DESCRIPTION_LENGTH}
										onChange={event => setDescription(event.target.value)}
										onDragOver={descriptionImages.onDragOver}
										onDragLeave={descriptionImages.onDragLeave}
										onDrop={descriptionImages.onDrop}
										onPaste={descriptionImages.onPaste}
										onKeyDown={event => {
											if (event.key === 'Escape') return cancelDescription();
											if (event.key !== 'Enter') return;

											// Enter confirms, so Shift+Enter is what a paragraph
											// break costs now. Cmd/Ctrl+Enter still confirms too,
											// which is what the comment boxes take.
											if (event.shiftKey) return;

											// An IME is mid-word: Enter is choosing a candidate,
											// not finishing the description. Committing here would
											// close the editor on a half-typed character.
											if (event.nativeEvent.isComposing) return;

											// Or the newline lands in the value on its way out.
											event.preventDefault();
											saveDescription();
										}}
										style={{
											font: 'inherit',
											fontFamily: CONTENT_FONT,
											fontSize: TEXT.prose,
											maxHeight: 320,
											overflowY: 'auto',
											...descriptionImages.dropStyle,
										}}
									/>

									<ActionRow>
										{descriptionImages.enabled && (
											<AddImageButton
												testId="description-image-input"
												busy={descriptionImages.busy}
												onPick={descriptionImages.pickFiles}
												inputRef={descriptionImages.inputRef}
												onInputChange={descriptionImages.onInputChange}
											/>
										)}
										<Button onClick={saveDescription}>save</Button>
										<Button variant="ghost" onClick={cancelDescription}>
											cancel
										</Button>
									</ActionRow>
								</>
							) : issue.description ? (
								<div
									style={{
										marginTop: 8,
										padding: '8px 10px',
										maxHeight: 320,
										overflowY: 'auto',
										background: GUI_THEME.panel2,
										borderRadius: 8,
									}}
								>
									{parseDiffCommentMeta(issue.description) ? (
										<CommentBody
											body={issue.description}
											onOpenDiffLocation={onOpenDiffLocation}
										/>
									) : (
										<MarkdownContent content={issue.description} />
									)}
								</div>
							) : (
								<Empty>No description</Empty>
							)}
						</Section>

						<Section
							title="Tags"
							action={
								(!issue.readonly && !addingTag && (
									<Button variant="ghost" onClick={() => setAddingTag(true)}>
										+
									</Button>
								)) ||
								(addingTag && (
									<Button variant="ghost" onClick={() => setAddingTag(false)}>
										-
									</Button>
								))
							}
						>
							<ChipRow>
								{issue.tags.length === 0 ? (
									<Empty>No tags</Empty>
								) : (
									issue.tags.map(tag => (
										<Button
											key={tag.id}
											variant="chip"
											disabled={issue.readonly}
											onClick={() => onRemoveTag(issue.id, tag.id)}
											title="Remove tag"
											style={{color: tag.color}}
										>
											{tag.name} {!issue.readonly && '×'}
										</Button>
									))
								)}
							</ChipRow>

							{addingTag && (
								<ChipRow>
									{availableTags.map(tag => (
										<Button
											key={tag.id}
											variant="chip"
											disabled={issue.readonly}
											onClick={() => onAddTag(issue.id, tag.name)}
											title="Add existing tag"
											style={{color: tag.color, opacity: 0.55}}
										>
											+ {tag.name}
										</Button>
									))}
								</ChipRow>
							)}

							{addingTag && tags.length > 0 && (
								<ChipRow>
									<Button
										variant="ghost"
										disabled={issue.readonly}
										onClick={() => setManagingTags(true)}
										title="Review and delete tags across the whole workspace"
									>
										manage tags…
									</Button>
								</ChipRow>
							)}

							{addingTag && (
								<AddRow>
									<Input
										value={tagName}
										autoFocus
										placeholder="tag name"
										onChange={event => setTagName(event.target.value)}
										onKeyDown={event => {
											if (event.key === 'Enter') addTag();
											if (event.key === 'Escape') {
												setTagName('');
												setAddingTag(false);
											}
										}}
									/>

									<Button onClick={addTag}>add</Button>
								</AddRow>
							)}
						</Section>

						<Section
							title="Assignees"
							action={
								(!issue.readonly && !addingAssignee && (
									<Button
										variant="ghost"
										onClick={() => {
											setAddingAssignee(true);
											onOpenAssigneePicker();
										}}
									>
										+
									</Button>
								)) ||
								(addingAssignee && (
									<Button
										variant="ghost"
										onClick={() => setAddingAssignee(false)}
									>
										-
									</Button>
								))
							}
						>
							<ChipRow>
								{issue.assignees.length === 0 ? (
									<Empty>No assignees</Empty>
								) : (
									issue.assignees.map(assignee => (
										<Button
											key={assignee.id}
											variant="chip"
											disabled={issue.readonly}
											onClick={() => onRemoveAssignee(issue.id, assignee.id)}
											title="Remove assignee"
											style={{color: assignee.color}}
										>
											@{assignee.name} {!issue.readonly && '×'}
										</Button>
									))
								)}
							</ChipRow>

							{addingAssignee && (
								<ChipRow>
									{availableAssignees.map(assignee => (
										<Button
											key={assignee.id}
											variant="chip"
											disabled={issue.readonly}
											onClick={() => onAddAssignee(issue.id, assignee.id)}
											title={
												assignee.isSelf
													? 'Assign yourself'
													: !assignee.hasAuthoredAnywhere
													? 'Has not contributed to this project'
													: 'Add existing assignee'
											}
											style={{
												color: assignee.isSelf
													? GUI_THEME.accent
													: assignee.color,
												opacity: assignee.isSelf ? 1 : 0.55,
												fontWeight: assignee.isSelf ? 600 : undefined,
												borderColor: assignee.isSelf
													? GUI_THEME.accent
													: undefined,
											}}
										>
											+ @{assignee.isSelf ? 'me' : assignee.name}
											{!assignee.hasAuthoredAnywhere ? ' ↗' : ''}
										</Button>
									))}
								</ChipRow>
							)}

							{addingAssignee &&
								assignees.some(a => !a.hasAuthoredAnywhere && !a.isRemoved) && (
									<ChipRow>
										<Button
											variant="ghost"
											disabled={issue.readonly}
											onClick={() => setManagingContributors(true)}
											title="Review and remove external contributors across the whole workspace"
										>
											manage contributors…
										</Button>
									</ChipRow>
								)}

							{addingAssignee && (
								<AddRow>
									<Input
										value={assigneeName}
										autoFocus
										placeholder="name of unknown contributor"
										onChange={event => setAssigneeName(event.target.value)}
										onKeyDown={event => {
											if (event.key === 'Enter') addAssignee();
											if (event.key === 'Escape') {
												setAssigneeName('');
												setAddingAssignee(false);
											}
										}}
									/>

									<Button
										onClick={addAssignee}
										title="Add someone who has not contributed to this board"
									>
										add
									</Button>
								</AddRow>
							)}
						</Section>

						<IssueAttachments
							issueId={issue.id}
							readonly={Boolean(issue.readonly)}
							attachments={attachments}
							uploadStatus={attachmentUploadStatus}
							onUploadFiles={onUploadAttachments}
							onDeleteAttachment={onDeleteAttachment}
						/>

						<Section
							title="Actions"
							action={
								!issue.readonly &&
								(issue.isClosed ? (
									<Button onClick={() => onReopenIssue(issue.id)}>
										reopen issue
									</Button>
								) : (
									<Button onClick={() => onCloseIssue(issue.id)}>
										close issue
									</Button>
								))
							}
						>
							{''}
						</Section>
					</>
				);

				const commentsPane = issue && (
					<IssueComments
						whoAmI={whoAmI}
						issueId={issue.id}
						readonly={issue.readonly}
						comments={comments}
						onAddComment={onAddComment}
						onDeleteComment={onDeleteComment}
						onEditComment={onEditComment}
						onOpenDiffLocation={onOpenDiffLocation}
						onUploadImages={issue.readonly ? undefined : onUploadAttachments}
					/>
				);

				const historyPane = issue && (
					<IssueHistory entries={history} onHoverEvent={onHoverHistoryEvent} />
				);

				const commitsPane = issue && (
					<IssueCommits
						issueRef={issue.ref}
						commits={commits}
						loading={commitsLoading}
						error={commitsError}
						diffsBySha={commitDiffsBySha}
						onLoadDiff={onLoadCommitDiff}
						expandAll={laneView}
						diffStyle={commitsWidth >= STACKED_DIFF_WIDTH ? 'split' : 'unified'}
						comments={comments}
						onAddComment={
							disabled ? undefined : body => onAddComment?.(issue.id, body)
						}
						onFileTicket={
							disabled
								? undefined
								: params => onFileTicket?.(issue.id, issue.ref, params)
						}
						focus={diffFocus}
					/>
				);

				return (
					<>
						{issue ? (
							<div
								style={
									laneView
										? {display: 'flex', flexDirection: 'column', height: '100%'}
										: undefined
								}
							>
								<FormHeader>
									<div
										style={{display: 'flex', alignItems: 'baseline', gap: 10}}
									>
										<span
											style={{
												color: GUI_THEME.secondary,
												fontSize: TEXT.label,
												textTransform: 'uppercase',
												letterSpacing: '0.08em',
											}}
										>
											{issue.ref && <CopyRef refValue={issue.ref} />}
										</span>

										{/* 0 when the id carries no time. Better to say nothing
										    than to date the ticket to 1970. */}
										{issue.createdAt > 0 && (
											<span
												data-testid="issue-created-at"
												title={formatAbsolute(issue.createdAt)}
												style={{
													fontSize: TEXT.meta,
													color: GUI_THEME.dim,
												}}
											>
												Created {timeAgo(issue.createdAt)}
											</span>
										)}
									</div>

									<div style={{display: 'flex', alignItems: 'center', gap: 2}}>
										<PanelDockMenu dock={dock} onDock={onDock} />
										<FullscreenToggleButton
											isFullscreen={isFullscreen}
											onClick={toggleFullscreen}
										/>
										<Button variant="ghost" onClick={onClose}>
											×
										</Button>
									</div>
								</FormHeader>

								{editingTitle ? (
									<textarea
										ref={titleTextareaRef}
										value={title}
										autoFocus
										rows={1}
										onChange={event => {
											setTitle(event.target.value);
											resizeTitleTextarea();
										}}
										onKeyDown={event => {
											if (event.key === 'Enter') {
												event.preventDefault();
												event.currentTarget.blur();
											}
											if (event.key === 'Escape') cancelTitle();
										}}
										onBlur={saveTitle}
										style={{
											display: 'block',
											width: '100%',
											boxSizing: 'border-box',
											resize: 'none',
											overflow: 'hidden',
											background: GUI_THEME.bg,
											color: GUI_THEME.primary,
											border: `1px solid ${GUI_THEME.line}`,
											borderRadius: 8,
											padding: '6px 10px',
											outline: 'none',
											font: 'inherit',
											fontSize: TEXT.title,
											fontWeight: 600,
											lineHeight: 1.35,
											marginBottom: 20,
										}}
									/>
								) : (
									<div
										onClick={() => !issue.readonly && setEditingTitle(true)}
										style={{
											marginBottom: 18,
											color: GUI_THEME.primary,
											fontSize: TEXT.title,
											fontWeight: 600,
											lineHeight: 1.35,
											wordBreak: 'break-word',
											cursor: issue.readonly ? 'default' : 'text',
										}}
									>
										{issue.title}
									</div>
								)}

								{laneView ? (
									<div
										style={{
											display: 'grid',
											gridTemplateColumns: laneColumns,
											gap: LANE_GAP,
											flex: 1,
											minHeight: 0,
											transition: `grid-template-columns ${LANE_COLLAPSE_MS}ms ease`,
										}}
									>
										{(
											[
												['overview', 'Overview', undefined, overviewPane],
												['comments', 'Comments', comments.length, commentsPane],
												['commits', 'Commits', commitsCount, commitsPane],
												['log', 'Log', history.length, historyPane],
											] as const
										).map(([key, title, count, pane]) => (
											<Lane
												key={key}
												title={title}
												count={count}
												collapsed={laneCollapsed[key]}
												canCollapse={laneCollapsed[key] || openLaneCount > 1}
												onToggle={() =>
													setLaneCollapsed[key](!laneCollapsed[key])
												}
											>
												{pane}
											</Lane>
										))}
									</div>
								) : (
									<>
										<Tabs
											tabs={tabs}
											activeTab={activeTab}
											onChange={onChangeTab}
										/>
										{activeTab === 'overview' && overviewPane}
										{activeTab === 'comments' && commentsPane}
										{activeTab === 'history' && historyPane}
										{activeTab === 'code' && commitsPane}
									</>
								)}
							</div>
						) : (
							<Empty>Select an issue</Empty>
						)}

						{managingContributors && (
							<ManageContributorsModal
								contributors={assignees}
								onRemove={onRemoveContributor}
								onClose={() => setManagingContributors(false)}
							/>
						)}

						{managingTags && (
							<ManageTagsModal
								tags={tags}
								onDelete={onDeleteTag}
								onClose={() => setManagingTags(false)}
							/>
						)}
					</>
				);
			}}
		</Aside>
	);
};
