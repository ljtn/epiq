import {useEffect, useRef} from 'react';
import {GuiComment, GuiIssue} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {
	THEATRE_CARD_IN_ANIMATION,
	THEATRE_FLASH_FRAMES,
	THEATRE_FLASH_TIMING,
} from '../lib/theatre';
import {isSwimlaneDrag} from '../lib/gui-move-swimlane';
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
	isolatedTagId,
	onFilterByTag,
	onDragOverIssue,
	onDropIssueAt,
	theatre,
	flashKey,
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
	// The tag the board is narrowed to, if it is exactly one.
	isolatedTagId: string | null;
	onFilterByTag: (tagId: string) => void;
	onDragOverIssue: (targetIndex: number) => void;
	onDropIssueAt: (issueId: string, targetIndex: number) => void;
	// The history player is up, so a card arriving on the board is one the movie
	// just produced and is worth an entrance.
	theatre: boolean;
	// The id of the event that just landed on this ticket, or null. Its identity
	// is what matters, not its content: two events in a row on one ticket have
	// to flash twice.
	flashKey: string | null;
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

	// Run off the element rather than through a CSS animation on the style prop:
	// the card's entrance already owns that property, and the board re-renders
	// on every frame of the movie, which would put the entrance back and cut a
	// running flash short. A web animation overrides the inline styles for its
	// own duration and reverts, and starts fresh on every call — which is what
	// makes two events in a row on one ticket flash twice.
	//
	// Deliberately not cancelled on the way out: events land closer together
	// than the flash is long, so cancelling as the spotlight moves to the next
	// ticket would cut every one of them short. A later flash on this same card
	// simply wins, and a finished one drops off on its own.
	useEffect(() => {
		const card = cardRef.current;
		if (!card || flashKey === null) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		card.animate(THEATRE_FLASH_FRAMES, THEATRE_FLASH_TIMING);
	}, [flashKey]);

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
				// A swimlane crossing the card belongs to the column underneath, which
				// decides its own landing edge.
				if (isSwimlaneDrag(event.dataTransfer)) return;

				event.preventDefault();
				event.dataTransfer.dropEffect = 'move';

				const rect = event.currentTarget.getBoundingClientRect();
				const isAfterMiddle = event.clientY > rect.top + rect.height / 2;

				onDragOverIssue(getVisualTargetIndex(isAfterMiddle));
			}}
			onDrop={event => {
				// Before stopPropagation, or a column dropped over a card would be
				// swallowed here and never reach the section's own handler.
				if (isSwimlaneDrag(event.dataTransfer)) return;

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
				// The flash is applied to the node directly (see above), so it must
				// not be set here too or React would put it back on every render and
				// cut the running one short.
				animation: theatre ? THEATRE_CARD_IN_ANIMATION : undefined,
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
						{ticket.tags.map(tag => {
							const isolated = tag.id === isolatedTagId;

							return (
								<button
									key={tag.id}
									type="button"
									data-testid="ticket-tag"
									aria-pressed={isolated}
									title={
										isolated
											? 'Show every ticket again'
											: `Show only tickets tagged ${tag.name}`
									}
									// Stopped here, or the click would also select the card.
									onClick={event => {
										event.stopPropagation();
										onFilterByTag(tag.id);
									}}
									style={{
										color: tag.color,
										border: `1px solid ${
											isolated ? tag.color : GUI_THEME.line
										}`,
										borderRadius: 999,
										padding: '2px 8px',
										fontSize: 11,
										fontFamily: 'inherit',
										lineHeight: 'inherit',
										background: isolated ? `${tag.color}22` : '#ffffff08',
										cursor: 'pointer',
									}}
								>
									{tag.name}
								</button>
							);
						})}
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
								borderRadius: 6,
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
							<User
								key={assignee.id}
								user={assignee}
								index={idx}
								isFocus={isSelected}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
};
