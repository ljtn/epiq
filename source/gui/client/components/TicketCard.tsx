import {GuiIssue} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {User} from './User';

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
				alignItems: 'flex-start',
				gap: 10,
				color: isSelected ? GUI_THEME.accent : GUI_THEME.primary,
				fontSize: 12,
				cursor: ticket.readonly ? 'default' : 'grab',
				background: isSelected
					? 'rgba(118,228,255,0.08)'
					: 'rgba(185, 192, 255, 0.06)',
				padding: '12px',
				minHeight: '48px',
				borderRadius: '12px',
				marginBottom: 4,
				border: `1px solid ${isSelected ? GUI_THEME.accent : 'transparent'}`,
			}}
		>
			<div
				style={{
					width: 20,
					flexShrink: 0,
					color: isSelected ? GUI_THEME.accent : GUI_THEME.secondary,
					fontVariantNumeric: 'tabular-nums',
					paddingTop: 2,
				}}
			>
				{isSelected ? '❯' : index + 1}
			</div>

			<div
				style={{
					flex: 1,
					minWidth: 0,
					display: 'flex',
					justifyContent: 'space-between',
					gap: 12,
				}}
			>
				<div
					style={{
						minWidth: 0,
						display: 'flex',
						flexDirection: 'column',
						gap: 10,
						flex: 1,
					}}
				>
					<div
						style={{
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
							fontWeight: 500,
							fontSize: 13,
						}}
					>
						{ticket.title}
					</div>

					<div
						style={{
							display: 'flex',
							flexWrap: 'wrap',
							gap: 6,
							alignItems: 'center',
						}}
					>
						{ticket.tags.map(tag => (
							<span
								key={tag.id}
								style={{
									color: tag.color,
									border: `1px solid ${GUI_THEME.line}`,
									borderRadius: 999,
									padding: '2px 8px',
									fontSize: 11,
									background: '#ffffff08',
								}}
							>
								{tag.name}
							</span>
						))}
					</div>
				</div>

				{ticket.assignees.length > 0 && (
					<div
						style={{
							display: 'flex',
							alignItems: 'flex-start',
							flexShrink: 0,
							paddingTop: 2,
						}}
					>
						{ticket.assignees.map((assignee, idx) => (
							<User user={assignee} index={idx} isFocus={isSelected}></User>
						))}
					</div>
				)}
			</div>
		</div>
	);
};
