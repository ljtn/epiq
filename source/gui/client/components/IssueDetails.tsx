import React, {useEffect, useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {GuiUser, GuiIssue, GuiTag, GuiComment} from '../lib/gui-state.model';
import {Aside} from './Aside';
import {Button} from './Button';
import {FormHeader} from './FormHeader';
import {
	ActionRow,
	AddRow,
	ChipRow,
	Empty,
	Input,
	Textarea,
} from './FormPrimitives';
import {IssueComments} from './IssueComments';
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
	onRemoveAssignee,
	onCloseIssue,
	onReopenIssue,
	onAddComment,
	onDeleteComment,
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
	onAddAssignee: (issueId: string, assigneeName: string) => void;
	onRemoveAssignee: (issueId: string, assigneeId: string) => void;
	onCloseIssue: (issueId: string) => void;
	onReopenIssue: (issueId: string) => void;
	onAddComment?: (issueId: string, body: string) => void;
	onDeleteComment?: (issueId: string, commentId: string) => void;
	knownTags: GuiTag[];
	knownAssignees: GuiUser[];
}) => {
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [tagName, setTagName] = useState('');
	const [assigneeName, setAssigneeName] = useState('');
	const [editingTitle, setEditingTitle] = useState(false);
	const [editingDescription, setEditingDescription] = useState(false);
	const [addingTag, setAddingTag] = useState(false);
	const [addingAssignee, setAddingAssignee] = useState(false);

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
		{id: 'overview', label: 'overview'},
		{id: 'comments', label: 'comments', count: comments.length},
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

		onAddAssignee(issue.id, assigneeName.trim());
		setAssigneeName('');
		setAddingAssignee(false);
	};

	const availableTags = tags.filter(
		tag => !issue?.tags.some(issueTag => issueTag.id === tag.id),
	);

	const availableAssignees = assignees.filter(
		assignee =>
			!issue?.assignees.some(issueAssignee => issueAssignee.id === assignee.id),
	);

	return (
		<Aside>
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
							{issue.ref && (
								<span style={{fontFamily: 'monospace', color: GUI_THEME.dim}}>
									{'#' + issue.ref}
								</span>
							)}
						</span>

						<Button variant="ghost" onClick={onClose}>
							×
						</Button>
					</FormHeader>

					<Tabs tabs={tabs} activeTab={activeTab} onChange={onChangeTab} />

					{activeTab === 'overview' && (
						<>
							<Section
								first={true}
								title="Title"
								action={
									!issue.readonly &&
									!editingTitle && (
										<Button
											variant="ghost"
											onClick={() => setEditingTitle(true)}
										>
											edit
										</Button>
									)
								}
							>
								{editingTitle ? (
									<>
										<Input
											value={title}
											autoFocus
											onChange={event => setTitle(event.target.value)}
											onKeyDown={event => {
												if (event.key === 'Enter') saveTitle();
												if (event.key === 'Escape') cancelTitle();
											}}
										/>

										<ActionRow>
											<Button onClick={saveTitle}>save</Button>
											<Button variant="ghost" onClick={cancelTitle}>
												cancel
											</Button>
										</ActionRow>
									</>
								) : (
									<div
										style={{
											marginTop: 8,
											color: GUI_THEME.primary,
											fontSize: 12,
											lineHeight: 1.45,
											wordBreak: 'break-word',
										}}
									>
										{issue.title}
									</div>
								)}
							</Section>

							<Section
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
										/>

										<ActionRow>
											<Button onClick={saveDescription}>save</Button>
											<Button variant="ghost" onClick={cancelDescription}>
												cancel
											</Button>
										</ActionRow>
									</>
								) : issue.description ? (
									<p
										style={{
											lineHeight: 1.55,
											whiteSpace: 'pre-wrap',
											margin: '8px 0 0',
											color: GUI_THEME.primary,
										}}
									>
										{issue.description}
									</p>
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
												onClick={() => onAddAssignee(issue.id, assignee.name)}
												title="Add existing assignee"
												style={{color: assignee.color, opacity: 0.55}}
											>
												+ @{assignee.name}
											</Button>
										))}
									</ChipRow>
								)}

								{addingAssignee && (
									<AddRow>
										<Input
											value={assigneeName}
											autoFocus
											placeholder="assignee name"
											onChange={event => setAssigneeName(event.target.value)}
											onKeyDown={event => {
												if (event.key === 'Enter') addAssignee();
												if (event.key === 'Escape') {
													setAssigneeName('');
													setAddingAssignee(false);
												}
											}}
										/>

										<Button onClick={addAssignee}>add</Button>
									</AddRow>
								)}
							</Section>

							<Section
								title="Actions"
								action={
									issue.isClosed ? (
										<Button onClick={() => onReopenIssue(issue.id)}>
											reopen issue
										</Button>
									) : (
										<Button onClick={() => onCloseIssue(issue.id)}>
											close issue
										</Button>
									)
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
		</Aside>
	);
};
