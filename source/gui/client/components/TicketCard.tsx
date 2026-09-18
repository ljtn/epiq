import {useEffect, useRef, useState} from 'react';
import {GuiComment, GuiIssue} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {
	THEATRE_CARD_IN_ANIMATION,
	THEATRE_FLASH_FRAMES,
	THEATRE_FLASH_TIMING,
} from '../lib/theatre';
import {isSwimlaneDrag} from '../lib/gui-move-swimlane';
// Types only, over the boundary `use-swimlane-stats` reads its own over.
import {RefDiffStat} from '../../../lib/stats/ref-diff-stats.model.js';
import {CARD_DIFF_GAP} from '../lib/diff-stat.style';
import {Button} from './Button';
import {DiffStat} from './DiffStat';
import {DwellLevel} from '../lib/lane-dwell';
import {formatDuration} from '../lib/gui-format.helper';
import {CopyRef} from './CopyRef';
import {IconButton, ICON_SIZE} from './IconButton';
import {IconClock} from './IconClock';
import {IconComment} from './IconComment';
import {User} from './User';

// The title's first line, which the controls at the card's right edge — the
// dwell, the comment count, the assignees — centre themselves on.
const TITLE_LINE_HEIGHT = 16;

// The index's box at the card's left edge: three figures at 10px, and the
// gap after it. Fixed, so a longer number never moves the title.
const CARD_INDEX_WIDTH = 22;
const CARD_INDEX_GAP = 8;

/** How long this ticket has sat in its lane, and how that reads beside its peers. */
export type CardDwell = {ms: number; level: DwellLevel};

// The one thing the figures beside it do not already say.
const diffTitle = (diff: RefDiffStat): string =>
	`${diff.commits} commit${diff.commits === 1 ? '' : 's'}`;

const DWELL_COLOR: Record<DwellLevel, string> = {
	none: GUI_THEME.dim,
	warn: GUI_THEME.amber,
	alert: GUI_THEME.red,
};

export const TicketCard = ({
	ticket,
	index,
	isSelected,
	isPicked,
	commentCount,
	onOpenComments,
	onOpenCode,
	onSelect,
	isolatedTagId,
	onFilterByTag,
	onDragOverIssue,
	onDropIssueAt,
	theatre,
	flashKey,
	dwell,
	diff,
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
	// The diff stat is the way into the commits behind it, the way the comment
	// count is the way into the comments.
	onOpenCode: (issueId: string) => void;
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
	// Null while the board is not showing the present, where an elapsed time
	// measured against now means nothing.
	dwell: CardDwell | null;
	// What the commits naming this ticket add up to, or null for a ticket no
	// commit names — which draws nothing at all. Most of a board is tickets
	// nobody has written code for yet, and a flat grey line on every one of
	// them would be a column of noise saying nothing.
	diff: RefDiffStat | null;
}) => {
	const cardRef = useRef<HTMLDivElement | null>(null);
	const [diffHovered, setDiffHovered] = useState(false);

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
				// Inherited by the title and nothing else: everything else on the card
				// sets a tone of its own.
				color:
					isSelected || isPicked ? GUI_THEME.accent : GUI_THEME.primarySoft,
				fontSize: 11,
				cursor: ticket.readonly ? 'default' : 'grab',
				background:
					isSelected || isPicked
						? 'rgba(118,228,255,0.08)'
						: 'rgba(185, 192, 255, 0.06)',
				// Roomier than a list row: a card is read, not scanned, and the
				// air around its title is what keeps a column of them from
				// running together.
				// None on the left: the index's box is the margin there.
				padding: '16px 18px 16px 0',
				minHeight: '58px',
				borderRadius: '8px',
				marginBottom: 8,
				border: `1px solid ${
					isSelected || isPicked ? GUI_THEME.accent : 'transparent'
				}`,
				// The flash is applied to the node directly (see above), so it must
				// not be set here too or React would put it back on every render and
				// cut the running one short.
				animation: theatre ? THEATRE_CARD_IN_ANIMATION : undefined,
			}}
		>
			{/* The card's number, on the title's first line. */}
			<span
				data-testid="ticket-index"
				aria-hidden
				style={{
					width: CARD_INDEX_WIDTH,
					marginRight: CARD_INDEX_GAP,
					flexShrink: 0,
					lineHeight: `${TITLE_LINE_HEIGHT}px`,
					textAlign: 'right',
					fontSize: 10,
					whiteSpace: 'nowrap',
					overflow: 'hidden',
					// A mark in the margin, not a figure to read: well under the
					// ref's tone, and no brighter on the selected card, so it can
					// never draw the eye off the title.
					color: GUI_THEME.dim,
					opacity: 0.4,
					fontVariantNumeric: 'tabular-nums',
				}}
			>
				{index + 1}
			</span>

			<div
				style={{
					flex: 1,
					minWidth: 0,
					display: 'flex',
					justifyContent: 'space-between',
					gap: 8,
				}}
			>
				<div
					style={{
						minWidth: 0,
						display: 'flex',
						flexDirection: 'column',
						gap: 12,
						flex: 1,
					}}
				>
					<div
						data-testid="ticket-title"
						style={{
							display: '-webkit-box',
							WebkitLineClamp: 2,
							WebkitBoxOrient: 'vertical',
							overflow: 'hidden',
							fontWeight: 400,
							fontSize: 12,
							lineHeight: `${TITLE_LINE_HEIGHT}px`,
							wordBreak: 'break-word',
						}}
					>
						{ticket.title}
					</div>

					{ticket.ref && (
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: CARD_DIFF_GAP,
								color: GUI_THEME.dim2,
								fontSize: 10,
							}}
						>
							<CopyRef refValue={ticket.ref} />
							{diff && (
								<button
									type="button"
									data-testid="ticket-diff"
									title={diffTitle(diff)}
									// Stopped here, or the click would also select the card
									// — which would land on whichever tab was already open.
									onClick={event => {
										event.stopPropagation();
										onOpenCode(ticket.id);
									}}
									onMouseEnter={() => setDiffHovered(true)}
									onMouseLeave={() => setDiffHovered(false)}
									// The hover ground is the button's only chrome, and it is
									// pulled back out again by an equal negative margin: the
									// ground reaches past the figures without the ref's line
									// growing under it.
									style={{
										display: 'flex',
										alignItems: 'center',
										padding: '2px 4px',
										margin: '-2px -4px',
										borderRadius: 4,
										background: diffHovered ? GUI_THEME.hover : 'transparent',
										border: 'none',
										cursor: 'pointer',
										transition: 'background 120ms ease',
									}}
								>
									<DiffStat
										insertions={diff.insertions}
										deletions={diff.deletions}
										variant="card"
										lit={diffHovered}
									/>
								</button>
							)}
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
								<Button
									key={tag.id}
									variant="chip"
									data-testid="ticket-tag"
									aria-pressed={isolated}
									tint={tag.color}
									held={isolated}
									dense
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
									style={{color: tag.color}}
								>
									{tag.name}
								</Button>
							);
						})}
					</div>
				</div>

				{/* The controls, each centred on the title's first line whatever its
				    own height: the box is that line's height and lets them overhang. */}
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 4,
						flexShrink: 0,
						height: TITLE_LINE_HEIGHT,
					}}
				>
					{dwell && dwell.level !== 'none' && (
						<span
							data-testid="ticket-dwell"
							data-dwell-level={dwell.level}
							title={`In this lane ${formatDuration(
								dwell.ms,
							)} — far longer than the rest of the column`}
							style={{
								display: 'inline-flex',
								alignItems: 'center',
								gap: 4,
								color: DWELL_COLOR[dwell.level],
								fontSize: 11,
								fontWeight: 600,
								lineHeight: 1,
								whiteSpace: 'nowrap',
								marginRight: 4,
							}}
						>
							<IconClock size={12} />
							<span>{formatDuration(dwell.ms)}</span>
						</span>
					)}

					{commentCount > 0 && (
						<IconButton
							testId="ticket-comments"
							title={`${commentCount} comment${commentCount === 1 ? '' : 's'}`}
							label={String(commentCount)}
							// Stopped here, or the click would also select the card.
							onClick={event => {
								event.stopPropagation();
								onOpenComments(ticket.id);
							}}
						>
							<IconComment size={ICON_SIZE} />
						</IconButton>
					)}

					{ticket.assignees.length > 0 && (
						<div style={{display: 'flex', flexShrink: 0, marginLeft: 4}}>
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
		</div>
	);
};
