import React, {useEffect, useRef, useState} from 'react';
import {SANS_FONT, GUI_THEME, TEXT} from '../lib/gui-theme';
import {
	GuiContributor,
	GuiUser,
	GuiGoal,
	GuiIssue,
	GuiTag,
	GuiComment,
	GuiAttachment,
	GuiRefCommitEntry,
	GuiSquashedDiff,
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
import {IconButton, ICON_SIZE} from './IconButton';
import {IconClose} from './IconPlayback';
import {TicketOnlyToggle} from './TicketOnlyToggle';
import {PanelDockMenu} from './PanelDockMenu';
import {IconCollapseLane} from './IconCollapseLane';
import {IconExpandLane} from './IconExpandLane';
import {AddRow, ChipRow, Empty, Input} from './FormPrimitives';
import {IssueAttachments} from './IssueAttachments';
import {AttachmentUploadStatus} from '../lib/use-issue-mutations';
import {CommentBody, IssueComments} from './IssueComments';
import {IssueCommits} from './IssueCommits';
import {DiffViewSwitch} from './DiffViewSwitch';
import {SquashedDiff} from './SquashedDiff';
import {CommitDiffState} from '../lib/use-issue-detail';
import {
	CommitFocus,
	DiffLocation,
	FileTicketParams,
} from '../lib/diff-selection';
import {parseDiffCommentMeta} from '../../../lib/utils/diff-comment.js';
import {DescriptionField} from './DescriptionField';
import {GoalSection} from './GoalSection';
import {Section} from './Section';
import {Tabs, TabItem} from './Tabs';
import {IssueStats} from './IssueStats';
import {IssueActivity} from './IssueActivity';
import {statsAcross} from '../lib/issue-stats.style';
import {useAddRow} from '../lib/use-add-row';
import {LogEntry} from '../lib/event-log';
import {IssueStats as IssueStatsPayload} from '../../../lib/stats/issue-stats.model.js';
import {BoardStats} from '../../../lib/stats/board-stats.js';
import {formatAbsolute, timeAgo} from '../lib/gui-format.helper';
import {usePersistedFlag} from '../lib/use-persisted-flag';
import {AsideDock} from '../lib/aside-dock';
import {MAX_DESCRIPTION_LENGTH} from '../../../lib/utils/text.limits.js';
import {useImageInsert} from '../lib/image-insert';
import {AddImageButton} from './AddImageButton';
import {useAutoGrow} from '../lib/use-auto-grow';
import {useEditDraft} from '../lib/ticket-drafts';

type IssueDetailsTab = 'overview' | 'comments' | 'code' | 'stats';

// The Code tab's two views and the switch between them. One object rather than
// five props: they are a single control and the thing it draws.
export type DiffViewState = {
	compacted: boolean;
	onChangeCompacted: (next: boolean) => void;
	squashed: GuiSquashedDiff | null;
	loading: boolean;
	error: string | null;
};

// Fullscreen at least this wide lays the three panes side by side instead of tabbed.
export const LANE_VIEW_WIDTH = 1400;
const LANE_GAP = 20;
const LANE_COUNT = 3;
// Code holds the patches, so it takes most of the row; the other two
// share the rest.
const LANE_SHARES = {
	overview: 1,
	comments: 1,
	commits: 3,
} as const;
type LaneKey = keyof typeof LANE_SHARES;
const LANE_KEYS = Object.keys(LANE_SHARES) as LaneKey[];

// Below this the tab labels wrap under their counts.
const TAB_COUNTS_WIDTH = 430;

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

// The collapsed lane's rail, the whole of it a target, hovering like IconButton.
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
			event.currentTarget.style.background = GUI_THEME.hover;
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
 * One lane, collapsible to a rail. Toggles aren't named after the lane, so a
 * header button never reads as a tab to the tests.
 */
const Lane = ({
	laneKey,
	title,
	count,
	collapsed,
	canCollapse,
	onToggle,
	children,
}: {
	// A stable key for test ids, independent of the heading's wording.
	laneKey: LaneKey;
	title: string;
	count?: number;
	collapsed: boolean;
	canCollapse: boolean;
	onToggle: () => void;
	children: React.ReactNode;
}) => {
	const label = `${title}${typeof count === 'number' ? ` (${count})` : ''}`;
	const testId = `lane-${laneKey}`;

	if (collapsed) {
		return (
			<div
				data-testid={testId}
				data-collapsed="true"
				style={{display: 'flex', minHeight: 0, overflow: 'hidden'}}
			>
				{/* The whole 28px rail is the target. */}
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

				{/* Only the button collapses the lane; the last open lane has none. */}
				{canCollapse && (
					<IconButton title={`Collapse ${title}`} onClick={onToggle}>
						<IconCollapseLane size={ICON_SIZE} />
					</IconButton>
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
	activeTab,
	onChangeTab,
	issue,
	onClose,
	timelineNarrowed,
	timelineCapped,
	canNarrowTimeline,
	onChangeTimelineNarrowed,
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
	diffFocusRequest,
	focusedCommentId,
	attachments,
	attachmentUploadStatus,
	onUploadAttachments,
	onDeleteAttachment,
	goals = [],
	onSetGoal,
	onCreateGoal,
	onManageGoals,
	commits,
	commitsLoading,
	commitsError,
	commitDiffsBySha,
	onLoadCommitDiff,
	diffView,
	stats,
	statsLoading,
	statsError,
	onOpenStatsFile,
	boardStats,
	activity,
	knownTags: tags,
	knownAssignees: assignees,
	onOpenAssigneePicker,
}: {
	dock: AsideDock;
	onDock: (next: AsideDock) => void;
	whoAmI: GuiUser;
	issue: GuiIssue | null;
	comments: GuiComment[];
	onClose: () => void;
	// The timeline narrowed to this ticket's stretch and events; switched here.
	timelineNarrowed: boolean;
	// The narrowed window came back as counts alone, naming no events.
	timelineCapped: boolean;
	// Offline the narrowing can still be let go of, just not taken up.
	canNarrowTimeline: boolean;
	onChangeTimelineNarrowed: (next: boolean) => void;
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
	// hands back where it currently points so the Code tab can open there.
	onOpenDiffLocation?: (location: DiffLocation) => void;
	diffFocus?: CommitFocus | null;
	// Changes on every request to open `diffFocus`, even the same one again.
	diffFocusRequest?: number;
	// The one comment a link points at, for the Comments tab to scroll to and
	// mark. Passed straight through: the tab owns what it looks like.
	focusedCommentId?: string | null;
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
	diffView: DiffViewState;
	stats: IssueStatsPayload | null;
	statsLoading: boolean;
	statsError: string | null;
	// Following a file from the Stats tab into its diff on the Code tab.
	onOpenStatsFile?: (file: {sha: string; path: string}) => void;
	// The board half of the Stats tab, worked out by the caller: what counts as
	// backwards is a fact about lane order, which lives up there.
	boardStats: BoardStats | null;
	// The ticket's own history, as log lines.
	activity: readonly LogEntry[];
	knownTags: GuiTag[];
	knownAssignees: GuiContributor[];
	// Fired when the picker opens, so the caller can fetch the list only then.
	onOpenAssigneePicker: () => void;
	// The Goal row's: the project's goals. Without onSetGoal the
	// row is not drawn.
	goals?: GuiGoal[];
	onSetGoal?: (issueId: string, goal: string | null) => void;
	onCreateGoal?: (name: string) => void;
	onManageGoals?: () => void;
}) => {
	// Unsent, so in the ticket's drafts.
	const titleEdit = useEditDraft(issue?.id ?? '', 'title', issue?.title ?? '');
	const descriptionEdit = useEditDraft(
		issue?.id ?? '',
		'description',
		issue?.description ?? '',
	);
	const editingTitle = titleEdit.editing;
	const title = titleEdit.text;
	const setEditingTitle = (editing: boolean) =>
		editing ? titleEdit.start() : titleEdit.stop();
	const [tagName, setTagName] = useState('');
	const [assigneeName, setAssigneeName] = useState('');
	const [managingContributors, setManagingContributors] = useState(false);
	const [managingTags, setManagingTags] = useState(false);
	const tagRow = useAddRow();
	const assigneeRow = useAddRow();
	const addingTag = tagRow.open;
	const addingAssignee = assigneeRow.open;
	// The Aside's live width, so the Code tab can pick split or unified diffs.
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
	const laneCollapsed: Record<LaneKey, boolean> = {
		overview: overviewCollapsed,
		comments: commentsCollapsed,
		commits: commitsCollapsed,
	};
	const setLaneCollapsed: Record<LaneKey, (next: boolean) => void> = {
		overview: setOverviewCollapsed,
		comments: setCommentsCollapsed,
		commits: setCommitsCollapsed,
	};
	// Collapsing the last one would leave four rails and nothing to read.
	const openLaneCount = LANE_KEYS.filter(key => !laneCollapsed[key]).length;
	const panelRef = useRef<HTMLElement | null>(null);
	const titleTextareaRef = useRef<HTMLTextAreaElement | null>(null);
	const descriptionRef = useRef<HTMLTextAreaElement | null>(null);

	useAutoGrow(titleTextareaRef, title, {active: editingTitle});

	useEffect(() => {
		setTagName('');
		setAssigneeName('');
		tagRow.close();
		assigneeRow.close();
	}, [issue?.id]);

	// A tab stays mounted once opened, for the ticket it was opened on.
	const [visited, setVisited] = useState<{
		issueId?: string;
		tabs: IssueDetailsTab[];
	}>({tabs: []});
	const visitedTabs = visited.issueId === issue?.id ? visited.tabs : [];
	if (!visitedTabs.includes(activeTab)) {
		setVisited({issueId: issue?.id, tabs: [...visitedTabs, activeTab]});
	}

	const disabled = !issue || issue.readonly;

	const canAddTag = !disabled && !addingTag;
	const startAddingTag = tagRow.start;
	const canAddAssignee = !disabled && !addingAssignee;
	const startAddingAssignee = assigneeRow.start;

	// The picker asks for the contributor list however it was opened.
	useEffect(() => {
		if (addingAssignee) onOpenAssigneePicker();
	}, [addingAssignee]);

	// Below `disabled`, which it reads: a readonly ticket takes no images.
	const descriptionImages = useImageInsert({
		issueId: issue?.id ?? '',
		setValue: descriptionEdit.setText,
		textareaRef: descriptionRef,
		onUploadImages: disabled ? undefined : onUploadAttachments,
	});

	// No count until the list has arrived: 0 would misread as "no commits".
	const commitsCount =
		commitsLoading || commitsError ? undefined : commits.length;

	const tabs: TabItem<IssueDetailsTab>[] = [
		{id: 'overview', label: 'Overview'},
		{id: 'comments', label: 'Comments', count: comments.length},
		{id: 'code', label: 'Code', count: commitsCount},
		{id: 'stats', label: 'Stats'},
	];

	const saveTitle = () => {
		if (disabled || !issue) return setEditingTitle(false);

		const nextTitle = title.trim();

		if (!nextTitle) return setEditingTitle(false);

		// Untouched, it has nothing to say, whatever the title is now.
		if (titleEdit.changed && nextTitle !== issue.title) {
			onEditTitle(issue.id, nextTitle);
		}

		setEditingTitle(false);
	};

	const cancelTitle = () => setEditingTitle(false);

	// The row stays open after an add, so several go on in a row; it closes
	// as focus leaves its section — see lib/use-add-row.
	const addTag = (name = tagName.trim()) => {
		if (disabled || !issue || !name) return;

		onAddTag(issue.id, name);
		setTagName('');
	};

	const addAssignee = () => {
		if (disabled || !issue || !assigneeName.trim()) return;

		onAddExternalAssignee(issue.id, assigneeName.trim());
		setAssigneeName('');
	};

	const pickAssignee = (assigneeId: string) => {
		if (disabled || !issue) return;

		onAddAssignee(issue.id, assigneeId);
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
				// A bottom dock already spans the window. Not width alone: a side panel at
				// MAX_ASIDE_WIDTH would flip into lanes on the last pixel.
				const laneView =
					(isFullscreen || dock === 'bottom') && panelWidth >= LANE_VIEW_WIDTH;

				// Collapsed lanes take a fixed rail; open ones split the rest.
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

				// Every track in pixels, since CSS can't animate `1fr` to `28px`. Floored, so
				// rounding never overflows the row.
				const laneWidth = (key: LaneKey): number =>
					laneCollapsed[key]
						? COLLAPSED_LANE_WIDTH
						: Math.floor(
								(laneRoom * LANE_SHARES[key]) / Math.max(openShares, 1),
						  );

				const laneColumns = LANE_KEYS.map(key => `${laneWidth(key)}px`).join(
					' ',
				);

				// The width the Code lane is actually given, which is what the
				// diff's split/unified choice has to follow.
				const commitsWidth = laneView ? laneWidth('commits') : panelWidth;

				const overviewPane = issue && (
					<>
						<DescriptionField
							draft={descriptionEdit}
							current={issue.description ?? ''}
							readonly={disabled}
							// The primitive's default of 1500 would truncate existing descriptions.
							maxLength={MAX_DESCRIPTION_LENGTH}
							onSave={text => onEditDescription(issue.id, text)}
							collapseKey={issue.id}
							textareaRef={descriptionRef}
							textareaProps={{
								onDragOver: descriptionImages.onDragOver,
								onDragLeave: descriptionImages.onDragLeave,
								onDrop: descriptionImages.onDrop,
								onPaste: descriptionImages.onPaste,
								style: descriptionImages.dropStyle,
							}}
							extraActions={
								descriptionImages.enabled && (
									<AddImageButton
										testId="description-image-input"
										busy={descriptionImages.busy}
										onPick={descriptionImages.pickFiles}
										inputRef={descriptionImages.inputRef}
										onInputChange={descriptionImages.onInputChange}
									/>
								)
							}
						>
							{parseDiffCommentMeta(issue.description ?? '') ? (
								<CommentBody
									body={issue.description ?? ''}
									onOpenDiffLocation={onOpenDiffLocation}
								/>
							) : undefined}
						</DescriptionField>

						<Section
							title="Tags"
							focusProps={disabled ? undefined : tagRow.sectionProps}
							action={
								(canAddTag && (
									<Button variant="ghost" onClick={startAddingTag}>
										+
									</Button>
								)) ||
								(addingTag && (
									<Button variant="ghost" onClick={tagRow.close}>
										-
									</Button>
								))
							}
						>
							<ChipRow
								testId="tags-row"
								onActivate={
									canAddTag && issue.tags.length > 0
										? startAddingTag
										: undefined
								}
							>
								{issue.tags.length === 0 ? (
									<Empty
										testId="tags-empty"
										onActivate={canAddTag ? startAddingTag : undefined}
									>
										No tags
									</Empty>
								) : (
									issue.tags.map(tag => (
										<Button
											key={tag.id}
											variant="chip"
											disabled={issue.readonly}
											onClick={() => onRemoveTag(issue.id, tag.id)}
											tint={tag.color}
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
											onClick={() => addTag(tag.name)}
											tint={tag.color}
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
										Manage tags…
									</Button>
								</ChipRow>
							)}

							{addingTag && (
								<AddRow>
									<Input
										ref={tagRow.inputRef}
										value={tagName}
										placeholder="Tag name"
										onChange={event => setTagName(event.target.value)}
										onKeyDown={event => {
											if (event.key === 'Enter') addTag();
											if (event.key === 'Escape') {
												setTagName('');
												tagRow.close();
											}
										}}
									/>

									<Button onClick={() => addTag()}>Add</Button>
								</AddRow>
							)}
						</Section>

						{onSetGoal && (
							<GoalSection
								issue={issue}
								goals={goals}
								onSetGoal={onSetGoal}
								onCreateGoal={onCreateGoal}
								onManageGoals={onManageGoals}
							/>
						)}

						<Section
							title="Assignees"
							focusProps={disabled ? undefined : assigneeRow.sectionProps}
							action={
								(canAddAssignee && (
									<Button variant="ghost" onClick={startAddingAssignee}>
										+
									</Button>
								)) ||
								(addingAssignee && (
									<Button variant="ghost" onClick={assigneeRow.close}>
										-
									</Button>
								))
							}
						>
							<ChipRow
								testId="assignees-row"
								onActivate={
									canAddAssignee && issue.assignees.length > 0
										? startAddingAssignee
										: undefined
								}
							>
								{issue.assignees.length === 0 ? (
									<Empty
										testId="assignees-empty"
										onActivate={
											canAddAssignee ? startAddingAssignee : undefined
										}
									>
										No assignees
									</Empty>
								) : (
									issue.assignees.map(assignee => (
										<Button
											key={assignee.id}
											variant="chip"
											disabled={issue.readonly}
											onClick={() => onRemoveAssignee(issue.id, assignee.id)}
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
											onClick={() => pickAssignee(assignee.id)}
											title={
												assignee.hasAuthoredAnywhere
													? undefined
													: 'Has not contributed to this project'
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
											Manage contributors…
										</Button>
									</ChipRow>
								)}

							{addingAssignee && (
								<AddRow>
									<Input
										ref={assigneeRow.inputRef}
										value={assigneeName}
										placeholder="Name of unknown contributor"
										onChange={event => setAssigneeName(event.target.value)}
										onKeyDown={event => {
											if (event.key === 'Enter') addAssignee();
											if (event.key === 'Escape') {
												setAssigneeName('');
												assigneeRow.close();
											}
										}}
									/>

									<Button onClick={addAssignee}>Add</Button>
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
										Reopen ticket
									</Button>
								) : (
									<Button onClick={() => onCloseIssue(issue.id)}>
										Close ticket
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
						focusedCommentId={focusedCommentId}
					/>
				);

				const perCommitPane = issue && (
					<IssueCommits
						issueRef={issue.ref}
						commits={commits}
						loading={commitsLoading}
						error={commitsError}
						diffsBySha={commitDiffsBySha}
						onLoadDiff={onLoadCommitDiff}
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
						focusRequest={diffFocusRequest}
					/>
				);

				const squashedPane = issue && (
					<SquashedDiff
						diff={diffView.squashed}
						loading={diffView.loading}
						error={diffView.error}
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
					/>
				);

				// The tab itself: the switch, which stays put across the change, and
				// whichever of the two views it names.
				const commitsPane = issue && (
					<div>
						<DiffViewSwitch
							compacted={diffView.compacted}
							onChange={diffView.onChangeCompacted}
							// The same count the tab wears, which is undefined until the
							// commits have actually arrived.
							commitCount={commitsCount}
						/>
						{/* With no commits, the per-commit view's empty state says how to link one. */}
						{diffView.compacted && commits.length > 0
							? squashedPane
							: perCommitPane}
					</div>
				);

				// A tab rather than a lane: numbers aren't read beside the diff.
				const statsPane = issue && (
					<IssueStats
						stats={stats}
						loading={statsLoading}
						error={statsError}
						onOpenFile={onOpenStatsFile}
						boardStats={boardStats}
						across={statsAcross(panelWidth - 2 * ASIDE_PADDING)}
						activity={<IssueActivity key={issue.id} entries={activity} />}
					/>
				);

				// Docked bottom, the title rides in the header row.
				const inlineTitle = dock === 'bottom';

				const titleNode =
					issue &&
					(editingTitle ? (
						<textarea
							ref={titleTextareaRef}
							value={title}
							autoFocus
							rows={1}
							onChange={event => titleEdit.setText(event.target.value)}
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
								background: GUI_THEME.well,
								color: GUI_THEME.primary,
								border: `1px solid ${GUI_THEME.line}`,
								borderRadius: 8,
								padding: '6px 10px',
								outline: 'none',
								font: 'inherit',
								fontSize: TEXT.title,
								fontWeight: 600,
								lineHeight: 1.4,
								marginBottom: inlineTitle ? 0 : 16,
							}}
						/>
					) : (
						<div
							onClick={() => !issue.readonly && setEditingTitle(true)}
							title={inlineTitle ? issue.title : undefined}
							style={{
								marginBottom: inlineTitle ? 0 : 14,
								color: GUI_THEME.primary,
								fontSize: TEXT.title,
								fontWeight: 600,
								lineHeight: 1.4,
								cursor: issue.readonly ? 'default' : 'text',
								// A long title truncates rather than wrapping the row.
								...(inlineTitle
									? {
											minWidth: 0,
											whiteSpace: 'nowrap',
											overflow: 'hidden',
											textOverflow: 'ellipsis',
									  }
									: {wordBreak: 'break-word'}),
							}}
						>
							{issue.title}
						</div>
					));

				// 0 when the id carries no time. Better to say nothing than to
				// date the ticket to 1970.
				const ageNode = issue && issue.createdAt > 0 && (
					<span
						data-testid="issue-created-at"
						title={formatAbsolute(issue.createdAt)}
						style={{
							fontSize: TEXT.meta,
							color: GUI_THEME.dim,
							whiteSpace: 'nowrap',
						}}
					>
						{timeAgo(issue.createdAt)}
					</span>
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
										style={{
											display: 'flex',
											alignItems: 'baseline',
											gap: 10,
											...(inlineTitle ? {flex: 1, minWidth: 0} : {}),
										}}
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

										{inlineTitle ? titleNode : ageNode}
									</div>

									{/* Beside the title, the age sits at the row's far end, centred with the buttons. */}
									<div style={{display: 'flex', alignItems: 'center', gap: 2}}>
										{/* Its own margin rather than the row's gap, which is
										    the spacing the three buttons keep from each other. */}
										{inlineTitle && (
											<span style={{marginRight: 6}}>{ageNode}</span>
										)}

										<TicketOnlyToggle
											narrowed={timelineNarrowed}
											capped={timelineCapped}
											disabled={!canNarrowTimeline}
											onChange={onChangeTimelineNarrowed}
										/>
										<PanelDockMenu dock={dock} onDock={onDock} />
										<FullscreenToggleButton
											isFullscreen={isFullscreen}
											onClick={toggleFullscreen}
										/>
										<IconButton title="Close" onClick={onClose}>
											<IconClose size={ICON_SIZE} />
										</IconButton>
									</div>
								</FormHeader>

								{!inlineTitle && titleNode}

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
												['commits', 'Code', commitsCount, commitsPane],
											] as const
										).map(([key, title, count, pane]) => (
											<Lane
												key={key}
												laneKey={key}
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
											showCounts={panelWidth >= TAB_COUNTS_WIDTH}
										/>
										{(
											[
												['overview', overviewPane],
												['comments', commentsPane],
												['code', commitsPane],
												['stats', statsPane],
											] as const
										)
											.filter(([tab]) => visitedTabs.includes(tab))
											.map(([tab, pane]) => (
												<div
													key={tab}
													data-testid={`tab-pane-${tab}`}
													hidden={tab !== activeTab}
												>
													{pane}
												</div>
											))}
									</>
								)}
							</div>
						) : (
							<Empty>Select a ticket</Empty>
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
