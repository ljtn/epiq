import React, {useEffect, useRef, useState} from 'react';
import {CONTENT_FONT, GUI_THEME} from '../lib/gui-theme';
import {
	GuiContributor,
	GuiUser,
	GuiIssue,
	GuiTag,
	GuiComment,
	GuiAttachment,
} from '../lib/gui-state.model';
import {Aside} from './Aside';
import {Button} from './Button';
import {RedactContributorsModal} from './RedactContributorsModal';
import {CopyRef} from './CopyRef';
import {FormHeader} from './FormHeader';
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
import {MarkdownContent} from './MarkdownContent';
import {Section} from './Section';
import {Tabs, TabItem} from './Tabs';

type IssueDetailsTab = 'overview' | 'comments';

export const IssueDetails = ({
	whoAmI,
	comments,
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
	onRedactContributor,
	onRemoveAssignee,
	onCloseIssue,
	onReopenIssue,
	onAddComment,
	onDeleteComment,
	attachments,
	attachmentUploadStatus,
	onUploadAttachments,
	onDeleteAttachment,
	knownTags: tags,
	knownAssignees: assignees,
}: {
	whoAmI: GuiUser;
	issue: GuiIssue | null;
	comments: GuiComment[];
	onClose: () => void;
	activeTab: IssueDetailsTab;
	onChangeTab: (tab: IssueDetailsTab) => void;
	onEditTitle: (issueId: string, title: string) => void;
	onEditDescription: (issueId: string, description: string) => void;
	onAddTag: (issueId: string, tagName: string) => void;
	onRemoveTag: (issueId: string, tagId: string) => void;
	// Picking someone known assigns by id. The name form exists only for the
	// typed "add external" path, which may name somebody with no record at
	// all — passing a name for a known person would mean resolving it back to
	// an id server-side, and two people sharing a display name make that
	// resolution a guess.
	onAddAssignee: (issueId: string, assigneeId: string) => void;
	onAddExternalAssignee: (issueId: string, assigneeName: string) => void;
	// Only meaningful for external contributors; the server refuses anyone who
	// has authored events.
	onRedactContributor: (contributorId: string) => void;
	onRemoveAssignee: (issueId: string, assigneeId: string) => void;
	onCloseIssue: (issueId: string) => void;
	onReopenIssue: (issueId: string) => void;
	onAddComment?: (issueId: string, body: string) => void;
	onDeleteComment?: (issueId: string, commentId: string) => void;
	attachments: GuiAttachment[];
	attachmentUploadStatus: AttachmentUploadStatus;
	onUploadAttachments?: (issueId: string, files: File[]) => void;
	onDeleteAttachment?: (issueId: string, attachmentId: string) => void;
	knownTags: GuiTag[];
	knownAssignees: GuiContributor[];
}) => {
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [tagName, setTagName] = useState('');
	const [assigneeName, setAssigneeName] = useState('');
	// Two-step rather than a browser confirm(): the effect is irreversible in
	// practice (the name is gone from every view), so it shouldn't be one
	// stray click away, but a modal dialog is heavier than this warrants.
	const [managingContributors, setManagingContributors] = useState(false);
	const [editingTitle, setEditingTitle] = useState(false);
	const [editingDescription, setEditingDescription] = useState(false);
	const [addingTag, setAddingTag] = useState(false);
	const [addingAssignee, setAddingAssignee] = useState(false);
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
		if (!issue) return;

		const handleClickOutside = (event: MouseEvent) => {
			if (
				panelRef.current &&
				!panelRef.current.contains(event.target as Node)
			) {
				onClose();
			}
		};

		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [issue, onClose]);

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

	const tabs: TabItem<IssueDetailsTab>[] = [
		{id: 'overview', label: 'Overview'},
		{id: 'comments', label: 'Comments', count: comments.length},
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

	// You first, then people who have worked on this board, then outsiders.
	// Self-assignment is far and away the common case, so it shouldn't require
	// finding your own name in a list that grows with the team.
	const assigneeRank = (assignee: GuiContributor): number =>
		assignee.isSelf ? 0 : assignee.isExternal ? 2 : 1;

	const availableAssignees = assignees
		.filter(
			assignee =>
				!issue?.assignees.some(
					issueAssignee => issueAssignee.id === assignee.id,
				),
		)
		// A redacted contributor has no name left to identify them by, so
		// offering them as a suggestion would mean picking blind — and their
		// name was cleared precisely so it would stop appearing.
		.filter(assignee => !assignee.isRedacted)
		.sort(
			(a, b) =>
				assigneeRank(a) - assigneeRank(b) || a.name.localeCompare(b.name),
		);

	return (
		<Aside ref={panelRef}>
			{issue ? (
				<>
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

						<Button variant="ghost" onClick={onClose}>
							×
						</Button>
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

					<Tabs tabs={tabs} activeTab={activeTab} onChange={onChangeTab} />

					{activeTab === 'overview' && (
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
											onClick={() => setAddingAssignee(true)}
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
														: assignee.isExternal
														? 'Has not contributed to this board'
														: 'Add existing assignee'
												}
												style={{
													color: assignee.isSelf
														? GUI_THEME.accent
														: assignee.color,
													// Self sits at full strength while everyone else is
													// dimmed back: it's the option reached for most
													// often, so it should be findable without reading
													// the row.
													opacity: assignee.isSelf ? 1 : 0.55,
													fontWeight: assignee.isSelf ? 600 : undefined,
													borderColor: assignee.isSelf
														? GUI_THEME.accent
														: undefined,
												}}
											>
												+ @{assignee.isSelf ? 'me' : assignee.name}
												{assignee.isExternal ? ' ↗' : ''}
											</Button>
										))}
									</ChipRow>
								)}

								{/* Opens a separate view rather than acting from here:
								    clearing a name is workspace-wide and permanent, and a
								    control among per-issue chips reads as issue-scoped. */}
								{addingAssignee &&
									assignees.some(a => a.isExternal && !a.isRedacted) && (
										<ChipRow>
											<Button
												variant="chip"
												disabled={issue.readonly}
												onClick={() => setManagingContributors(true)}
												title="Review contributors and clear names across the whole workspace"
												style={{color: GUI_THEME.dim, opacity: 0.55}}
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

										{/* The warning lives in the placeholder rather than the
										    button label: this path can invent a person who has
										    never touched the board, and the field is where you're
										    looking while deciding to do it. A long button label
										    also crowded the row. */}
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
					)}

					{activeTab === 'comments' && (
						<IssueComments
							whoAmI={whoAmI}
							issueId={issue.id}
							readonly={issue.readonly}
							comments={comments}
							onAddComment={onAddComment}
							onDeleteComment={onDeleteComment}
						/>
					)}
				</>
			) : (
				<Empty>Select an issue</Empty>
			)}

			{managingContributors && (
				<RedactContributorsModal
					contributors={assignees}
					onRedact={ids => ids.forEach(onRedactContributor)}
					onClose={() => setManagingContributors(false)}
				/>
			)}
		</Aside>
	);
};
