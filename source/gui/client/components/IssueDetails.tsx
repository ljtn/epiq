import React, {useEffect, useState} from 'react';
import {colorFromString} from '../App';
import {GUI_THEME} from '../lib/gui-theme';
import {GuiIssue} from '../lib/gui-state.model';

export const IssueDetails = ({
	issue,
	onClose,
	onEditTitle,
	onEditDescription,
}: {
	issue: GuiIssue | null;
	onClose: () => void;
	onEditTitle: (issueId: string, title: string) => void;
	onEditDescription: (issueId: string, description: string) => void;
}) => {
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');

	useEffect(() => {
		setTitle(issue?.title ?? '');
		setDescription(issue?.description ?? '');
	}, [issue?.id, issue?.title, issue?.description]);

	const saveTitle = () => {
		if (!issue || issue.readonly) return;
		if (title.trim() === issue.title) return;

		onEditTitle(issue.id, title);
	};

	const saveDescription = () => {
		if (!issue || issue.readonly) return;
		if (description === issue.description) return;

		onEditDescription(issue.id, description);
	};

	return (
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
			{issue ? (
				<>
					<div
						style={{
							display: 'flex',
							justifyContent: 'space-between',
							gap: 12,
							marginBottom: 18,
						}}
					>
						<strong style={{color: GUI_THEME.accent}}>Issue details</strong>

						<button
							type="button"
							onClick={onClose}
							style={{
								background: 'transparent',
								border: `1px solid ${GUI_THEME.line}`,
								color: GUI_THEME.secondary,
								borderRadius: 8,
								cursor: 'pointer',
							}}
						>
							close
						</button>
					</div>

					<input
						value={title}
						disabled={issue.readonly}
						onChange={event => setTitle(event.target.value)}
						onBlur={saveTitle}
						onKeyDown={event => {
							if (event.key === 'Enter') {
								event.currentTarget.blur();
							}
						}}
						style={{
							width: '100%',
							boxSizing: 'border-box',
							background: GUI_THEME.bg,
							color: GUI_THEME.primary,
							border: `1px solid ${GUI_THEME.line}`,
							borderRadius: 8,
							padding: '8px 10px',
							fontSize: 14,
							fontWeight: 700,
							marginBottom: 14,
						}}
					/>

					<textarea
						value={description}
						disabled={issue.readonly}
						onChange={event => setDescription(event.target.value)}
						onBlur={saveDescription}
						placeholder="No description"
						style={{
							width: '100%',
							minHeight: 140,
							boxSizing: 'border-box',
							background: GUI_THEME.bg,
							color: GUI_THEME.primary,
							border: `1px solid ${GUI_THEME.line}`,
							borderRadius: 8,
							padding: 10,
							lineHeight: 1.6,
							resize: 'vertical',
							font: 'inherit',
						}}
					/>

					<div style={{marginTop: 24}}>
						<strong>Tags</strong>

						<div
							style={{display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10}}
						>
							{issue.tags.length === 0 ? (
								<span style={{color: GUI_THEME.secondary}}>No tags</span>
							) : (
								issue.tags.map(tag => (
									<span
										key={tag.id}
										style={{
											color: colorFromString(tag.name),
											border: `1px solid ${GUI_THEME.line}`,
											borderRadius: 999,
											padding: '4px 8px',
										}}
									>
										■ {tag.name}
									</span>
								))
							)}
						</div>
					</div>

					<div style={{marginTop: 24}}>
						<strong>Assignees</strong>

						<div
							style={{display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10}}
						>
							{issue.assignees.length === 0 ? (
								<span style={{color: GUI_THEME.secondary}}>No assignees</span>
							) : (
								issue.assignees.map(assignee => (
									<span
										key={assignee.id}
										style={{
											color: colorFromString(assignee.name),
											border: `1px solid ${GUI_THEME.line}`,
											borderRadius: 999,
											padding: '4px 8px',
										}}
									>
										@{assignee.name}
									</span>
								))
							)}
						</div>
					</div>
				</>
			) : (
				<div style={{color: GUI_THEME.secondary}}>Select an issue</div>
			)}
		</aside>
	);
};
