import React from 'react';
import {colorFromString} from '../App';
import {GUI_THEME} from '../lib/gui-theme';
import {GuiIssue} from '../lib/gui-state.model';

export const IssueDetails = ({
	issue,
	onClose,
}: {
	issue: GuiIssue | null;
	onClose: () => void;
}) => (
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

				<h2 style={{fontSize: 14, marginTop: 0}}>{issue.title}</h2>

				{issue.description ? (
					<p style={{lineHeight: 1.6, whiteSpace: 'pre-wrap'}}>
						{issue.description}
					</p>
				) : (
					<p style={{color: GUI_THEME.secondary}}>No description</p>
				)}

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
