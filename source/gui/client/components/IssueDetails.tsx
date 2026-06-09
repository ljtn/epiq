import React, {useEffect, useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {GuiAssignee, GuiIssue, GuiTag} from '../lib/gui-state.model';
import {Button} from './Button';

export const IssueDetails = ({
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
	knownTags: tags,
	knownAssignees: assignees,
}: {
	issue: GuiIssue | null;
	onClose: () => void;
	onEditTitle: (issueId: string, title: string) => void;
	onEditDescription: (issueId: string, description: string) => void;
	onAddTag: (issueId: string, tagName: string) => void;
	onRemoveTag: (issueId: string, tagId: string) => void;
	onAddAssignee: (issueId: string, assigneeName: string) => void;
	onRemoveAssignee: (issueId: string, assigneeId: string) => void;
	onCloseIssue: (issueId: string) => void;
	onReopenIssue: (issueId: string) => void;
	knownTags: GuiTag[];
	knownAssignees: GuiAssignee[];
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
					<Section
						first={true}
						title="Title"
						action={
							!issue.readonly &&
							!editingTitle && (
								<Button variant="ghost" onClick={() => setEditingTitle(true)}>
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
									<Button onClick={saveTitle}>Save</Button>
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
									fontSize: 13,
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
									placeholder="-"
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
								<Button variant="ghost" onClick={() => setAddingAssignee(true)}>
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
			) : (
				<Empty>Select an issue</Empty>
			)}
		</Aside>
	);
};

const Aside = ({children}: {children: React.ReactNode}) => (
	<aside
		style={{
			width: 380,
			minWidth: 380,
			borderLeft: `1px solid ${GUI_THEME.line}`,
			background: GUI_THEME.panel,
			padding: 18,
			fontSize: 12,
			overflow: 'auto',
		}}
	>
		{children}
	</aside>
);

const Header = ({children}: {children: React.ReactNode}) => (
	<div
		style={{
			display: 'flex',
			justifyContent: 'space-between',
			alignItems: 'center',
			gap: 12,
			marginBottom: 18,
		}}
	>
		{children}
	</div>
);

const Section = ({
	title,
	action,
	children,
	first = false,
}: {
	first?: boolean;
	title: string;
	action?: React.ReactNode;
	children: React.ReactNode;
}) => (
	<section
		style={{
			padding: first ? '0px 0 14px 0' : '14px 0',
			borderTop: first ? 'none' : `1px solid ${GUI_THEME.line}`,
		}}
	>
		<div
			style={{
				display: 'flex',
				justifyContent: 'space-between',
				alignItems: 'center',
				gap: 12,
			}}
		>
			<span
				style={{
					color: GUI_THEME.secondary,
					fontSize: 10,
					textTransform: 'uppercase',
					letterSpacing: '0.08em',
				}}
			>
				{title}
			</span>

			{action}
		</div>

		{children}
	</section>
);

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
	<input
		{...props}
		style={{
			width: '100%',
			boxSizing: 'border-box',
			background: GUI_THEME.bg,
			color: GUI_THEME.primary,
			border: `1px solid ${GUI_THEME.line}`,
			borderRadius: 8,
			padding: '8px 10px',
			outline: 'none',
			font: 'inherit',
			...props.style,
		}}
	/>
);

const Textarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
	<textarea
		{...props}
		style={{
			width: '100%',
			minHeight: 140,
			boxSizing: 'border-box',
			background: GUI_THEME.bg,
			color: GUI_THEME.primary,
			border: `1px solid ${GUI_THEME.line}`,
			borderRadius: 8,
			padding: '8px 10px',
			outline: 'none',
			lineHeight: 1.6,
			resize: 'vertical',
			font: 'inherit',
			...props.style,
		}}
	/>
);

const ActionRow = ({children}: {children: React.ReactNode}) => (
	<div
		style={{
			display: 'flex',
			justifyContent: 'flex-end',
			gap: 8,
			marginTop: 8,
		}}
	>
		{children}
	</div>
);

const AddRow = ({children}: {children: React.ReactNode}) => (
	<div
		style={{
			display: 'flex',
			gap: 8,
			marginTop: 10,
		}}
	>
		{children}
	</div>
);

const ChipRow = ({children}: {children: React.ReactNode}) => (
	<div
		style={{
			display: 'flex',
			gap: 8,
			flexWrap: 'wrap',
			marginTop: 10,
		}}
	>
		{children}
	</div>
);

const Empty = ({children}: {children: React.ReactNode}) => (
	<span
		style={{
			display: 'inline-block',
			marginTop: 8,
			color: GUI_THEME.dim,
		}}
	>
		{children}
	</span>
);
