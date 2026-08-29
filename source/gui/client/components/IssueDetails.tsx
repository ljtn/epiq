import React, {useEffect, useRef, useState} from 'react';
import {CONTENT_FONT, GUI_THEME} from '../lib/gui-theme';
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
import {
	ActionRow,
	AddRow,
	ChipRow,
	Empty,
	Input,
	Textarea,
} from './FormPrimitives';
import {AttachmentUploadStatus, IssueAttachments} from './IssueAttachments';
import {IssueComments} from './IssueComments';
import {
	CommitDiffState,
	DiffLocation,
	FileTicketParams,
	IssueCommits,
} from './IssueCommits';
import {MarkdownContent} from './MarkdownContent';
import {Section} from './Section';
import {Tabs, TabItem} from './Tabs';
import {IssueHistory} from './IssueHistory';
import {formatAbsolute, timeAgo} from '../lib/gui-format.helper';

type IssueDetailsTab = 'overview' | 'comments' | 'history' | 'code';

// Fullscreen on a panel at least this wide drops the tabs and lays the four
// panes out side by side. Below it, four lanes would be too narrow to read,
// so fullscreen keeps the tabbed layout.
export const LANE_VIEW_WIDTH = 1400;
const LANE_GAP = 20;
const LANE_COUNT = 4;
// Commits holds diffs, so it takes half the row; the other three share the rest.
const LANE_COLUMNS =
	'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 3fr) minmax(0, 1fr)';
const COMMITS_LANE_SHARE = 3 / 6;

const Lane = ({
	title,
	count,
	children,
}: {
	title: string;
	count?: number;
	children: React.ReactNode;
}) => (
	<div
		data-testid={`lane-${title.toLowerCase()}`}
		style={{display: 'flex', flexDirection: 'column', minHeight: 0}}
	>
		<div
			style={{
				color: GUI_THEME.secondary,
				fontSize: 10,
				textTransform: 'uppercase',
				letterSpacing: '0.08em',
				paddingBottom: 10,
				marginBottom: 14,
				borderBottom: `1px solid ${GUI_THEME.line}`,
			}}
		>
			{title}
			{typeof count === 'number' && ` (${count})`}
		</div>
		<div style={{flex: 1, minHeight: 0, overflowY: 'auto'}}>{children}</div>
	</div>
);

export const IssueDetails = ({
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
	onFileTicket?: (
		originIssueId: string,
		originRef: string,
		params: FileTicketParams,
	) => void;
	// Following a comment's permalink: the caller puts it in the URL, and
	// hands back where it currently points so the Commits tab can open there.
	onOpenDiffLocation?: (location: DiffLocation) => void;
	diffFocus?: DiffLocation | null;
	attachments: GuiAttachment[];
	attachmentUploadStatus: AttachmentUploadStatus;
	onUploadAttachments?: (issueId: string, files: File[]) => void;
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
	const panelRef = useRef<HTMLElement | null>(null);
	const titleTextareaRef = useRef<HTMLTextAreaElement | null>(null);

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
		<Aside ref={panelRef} onWidthChange={setPanelWidth}>
			{({isFullscreen, toggleFullscreen}) => {
				const laneView = isFullscreen && panelWidth >= LANE_VIEW_WIDTH;
				const commitsWidth = laneView
					? (panelWidth - ASIDE_PADDING * 2 - LANE_GAP * (LANE_COUNT - 1)) *
					  COMMITS_LANE_SHARE
					: panelWidth;

				const overviewPane = issue && (
					<>
						{/* 0 when the id carries no time. Better to say nothing than to
							    date the ticket to 1970. */}
						{issue.createdAt > 0 && (
							<div
								data-testid="issue-created-at"
								title={formatAbsolute(issue.createdAt)}
								style={{
									fontSize: 11,
									color: GUI_THEME.dim,
									marginBottom: 14,
								}}
							>
								Created {timeAgo(issue.createdAt)}
							</div>
						)}

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
										value={description}
										autoFocus
										placeholder=""
										onChange={event => setDescription(event.target.value)}
										onKeyDown={event => {
											if (event.key === 'Escape') cancelDescription();
											if (
												(event.metaKey || event.ctrlKey) &&
												event.key === 'Enter'
											) {
												saveDescription();
											}
										}}
										style={{
											font: 'inherit',
											fontFamily: CONTENT_FONT,
											fontSize: 13,
											maxHeight: 320,
											overflowY: 'auto',
										}}
									/>

									<ActionRow>
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
										padding: '12px 16px',
										maxHeight: 320,
										overflowY: 'auto',
										background: GUI_THEME.tertiary,
										borderRadius: 8,
									}}
								>
									<MarkdownContent content={issue.description} />
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
						onOpenDiffLocation={onOpenDiffLocation}
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
									<span
										style={{
											color: GUI_THEME.secondary,
											fontSize: 10,
											textTransform: 'uppercase',
											letterSpacing: '0.08em',
										}}
									>
										{issue.ref && <CopyRef refValue={issue.ref} />}
									</span>

									<div style={{display: 'flex', alignItems: 'center', gap: 2}}>
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
											fontSize: 18,
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
											fontSize: 18,
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
											gridTemplateColumns: LANE_COLUMNS,
											gap: LANE_GAP,
											flex: 1,
											minHeight: 0,
										}}
									>
										<Lane title="Overview">{overviewPane}</Lane>
										<Lane title="Comments" count={comments.length}>
											{commentsPane}
										</Lane>
										<Lane title="Commits" count={commitsCount}>
											{commitsPane}
										</Lane>
										<Lane title="Log" count={history.length}>
											{historyPane}
										</Lane>
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
