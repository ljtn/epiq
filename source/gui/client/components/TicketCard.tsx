import {useEffect, useRef} from 'react';
import {GuiComment, GuiIssue} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {CopyRef} from './CopyRef';
import {IconComment} from './IconComment';
import {User} from './User';

export const TicketCard = ({
	ticket,
	index,
	isSelected,
	isPicked,
	commentCount,
	onOpenComments,
	onSelect,
	onDragOverIssue,
	onDropIssueAt,
}: {
	ticket: GuiIssue;
	index: number;
	isSelected: boolean;
	// Part of a multi-ticket selection, which reads differently from the one
	// ticket whose details are open.
	isPicked: boolean;
	onSelect: (options: {toggle: boolean}) => void;
	commentCount: number;
	onOpenComments: (issueId: string) => void;
	onDragOverIssue: (targetIndex: number) => void;
	onDropIssueAt: (issueId: string, targetIndex: number) => void;
}) => {
	const cardRef = useRef<HTMLDivElement | null>(null);

	// Opening the details panel takes 440px off the board, which can leave the
	// card that was just clicked behind it.
	useEffect(() => {
		if (!isSelected) return;

		cardRef.current?.scrollIntoView({
			behavior: 'smooth',
			block: 'nearest',
			inline: 'nearest',
		});
	}, [isSelected]);

	const getVisualTargetIndex = (isAfterMiddle: boolean) =>
		index + (isAfterMiddle ? 1 : 0);

	return (
		<div
			ref={cardRef}
			draggable={!ticket.readonly}
			// Stopped here, or the board's own click handler would clear the
			// selection this click just made.
			onClick={event => {
				event.stopPropagation();
				onSelect({toggle: event.metaKey || event.ctrlKey || event.shiftKey});
			}}
			// Carries the id and nothing else. Selecting here would navigate to
			// the issue route mid-drag, remounting the board under the pointer so
			// the drop never lands.
			onDragStart={event => {
				event.dataTransfer.effectAllowed = 'move';
				event.dataTransfer.setData('text/plain', ticket.id);
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
				color: isSelected || isPicked ? GUI_THEME.accent : GUI_THEME.primary,
				fontSize: 11,
				cursor: ticket.readonly ? 'default' : 'grab',
				background:
					isSelected || isPicked
						? 'rgba(118,228,255,0.08)'
						: 'rgba(185, 192, 255, 0.06)',
				padding: '10px 8px',
				minHeight: '58px',
				borderRadius: '8px',
				marginBottom: 4,
				border: `1px solid ${
					isSelected || isPicked ? GUI_THEME.accent : 'transparent'
				}`,
				// Only the multi-selection is outlined, so it stays legible when the
				// details panel is closed.
				outline: isPicked ? `1px solid ${GUI_THEME.accent}` : undefined,
				outlineOffset: 1,
			}}
		>
			<div
				style={{
					width: 16,
					flexShrink: 0,
					textAlign: 'right',
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
					paddingLeft: 8,
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
							display: '-webkit-box',
							WebkitLineClamp: 2,
							WebkitBoxOrient: 'vertical',
							overflow: 'hidden',
							fontWeight: 400,
							fontSize: 12,
							lineHeight: 1.35,
							wordBreak: 'break-word',
						}}
					>
						{ticket.title}
					</div>

					{ticket.ref && (
						<div
							style={{
								color: GUI_THEME.dim2,
								fontSize: 10,
							}}
						>
							<CopyRef refValue={ticket.ref} />
						</div>
					)}

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

				<div
					style={{
						display: 'flex',
						alignItems: 'flex-start',
						gap: 8,
						flexShrink: 0,
						paddingTop: 2,
					}}
				>
					{commentCount > 0 && (
						<button
							type="button"
							title={`${commentCount} comment${commentCount === 1 ? '' : 's'}`}
							onClick={event => {
								event.stopPropagation();
								onOpenComments(ticket.id);
							}}
							style={{
								display: 'inline-flex',
								alignItems: 'center',
								gap: 5,
								color: isSelected ? GUI_THEME.accent : GUI_THEME.secondary,
								background: isSelected
									? 'rgba(118,228,255,0.10)'
									: 'rgba(255,255,255,0.035)',
								border: `1px solid ${
									isSelected ? 'rgba(118,228,255,0.28)' : GUI_THEME.line
								}`,
								borderRadius: 999,
								padding: '3px 7px',
								fontSize: 11,
								fontWeight: 600,
								lineHeight: 1,
								cursor: 'pointer',
								marginTop: '-4px',
								transition:
									'background 120ms ease, border-color 120ms ease, color 120ms ease, transform 120ms ease',
							}}
							onMouseEnter={event => {
								event.currentTarget.style.background = 'rgba(118,228,255,0.12)';
								event.currentTarget.style.borderColor =
									'rgba(118,228,255,0.35)';
								event.currentTarget.style.color = GUI_THEME.accent;
								event.currentTarget.style.transform = 'translateY(-1px)';
							}}
							onMouseLeave={event => {
								event.currentTarget.style.background = isSelected
									? 'rgba(118,228,255,0.10)'
									: 'rgba(255,255,255,0.035)';
								event.currentTarget.style.borderColor = isSelected
									? 'rgba(118,228,255,0.28)'
									: GUI_THEME.line;
								event.currentTarget.style.color = isSelected
									? GUI_THEME.accent
									: GUI_THEME.secondary;
								event.currentTarget.style.transform = 'translateY(0)';
							}}
						>
							<IconComment />
							<span>{commentCount}</span>
						</button>
					)}
				</div>

				{ticket.assignees.length > 0 && (
					<div
						style={{
							display: 'flex',
							alignItems: 'flex-start',
							flexShrink: 0,
							paddingTop: 2,
							marginTop: '-4px',
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
