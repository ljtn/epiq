import React from 'react';
import {colorFromString} from '../App';
import {GuiIssue} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';

export const TicketCard = ({
	ticket,
	index,
	isSelected,
	onSelect,
	onDragStart,
	onDragOverIssue,
	onDropIssueAt,
}: {
	ticket: GuiIssue;
	index: number;
	isSelected: boolean;
	onSelect: () => void;
	onDragStart: (issueId: string) => void;
	onDragOverIssue: (targetIndex: number) => void;
	onDropIssueAt: (issueId: string, targetIndex: number) => void;
}) => {
	const getVisualTargetIndex = (isAfterMiddle: boolean) =>
		index + (isAfterMiddle ? 1 : 0);

	return (
		<div
			draggable={!ticket.readonly}
			onClick={onSelect}
			onDragStart={event => {
				event.dataTransfer.effectAllowed = 'move';
				event.dataTransfer.setData('text/plain', ticket.id);
				onDragStart(ticket.id);
			}}
			onDragOver={event => {
				event.preventDefault();
				event.dataTransfer.dropEffect = 'move';

				const rect = event.currentTarget.getBoundingClientRect();
				const isAfterMiddle = event.clientY > rect.top + rect.height / 2;

				onDragOverIssue(getVisualTargetIndex(isAfterMiddle));
			}}
			onDrop={event => {
				event.preventDefault();
				event.stopPropagation();

				const issueId = event.dataTransfer.getData('text/plain');
				if (!issueId) return;

				const rect = event.currentTarget.getBoundingClientRect();
				const isAfterMiddle = event.clientY > rect.top + rect.height / 2;

				onDropIssueAt(issueId, getVisualTargetIndex(isAfterMiddle));
			}}
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				gap: 12,
				color: isSelected ? GUI_THEME.accent : GUI_THEME.primary,
				fontSize: 12,
				cursor: ticket.readonly ? 'default' : 'grab',
				background: isSelected ? 'rgba(118,228,255,0.08)' : '#ffffff08',
				padding: '0 12px',
				height: '48px',
				borderRadius: '12px',
				marginBottom: 4,
			}}
		>
			<div style={{display: 'flex', gap: 10, minWidth: 0}}>
				<div
					style={{
						width: 28,
						color: isSelected ? GUI_THEME.accent : GUI_THEME.secondary,
						fontVariantNumeric: 'tabular-nums',
					}}
				>
					{isSelected ? '❯' : index + 1}
				</div>

				<div
					style={{
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
					}}
				>
					{ticket.title}
				</div>
			</div>

			<div style={{display: 'flex', gap: 8, flexShrink: 0}}>
				{ticket.tags.map(tag => (
					<span
						key={tag.id}
						style={{
							color: colorFromString(tag.name),
							border: `1px solid ${GUI_THEME.line}`,
							borderRadius: 999,
							padding: '4px 8px',
						}}
					>
						{tag.name}
					</span>
				))}

				{ticket.assignees.map(assignee => (
					<span
						key={assignee.id}
						title={assignee.name}
						style={{
							color: colorFromString(assignee.name),
							fontSize: 12,
							fontWeight: 700,
						}}
					>
						@{assignee.name.at(0)}
					</span>
				))}
			</div>
		</div>
	);
};
