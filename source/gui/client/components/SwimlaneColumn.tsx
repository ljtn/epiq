import React, {useState} from 'react';
import {DropIndicator} from '../App';
import {GuiComment, GuiIssue, GuiSwimlane} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {formatDuration} from '../lib/gui-format.helper';
import {dwellLevel, dwellOf, laneDwell} from '../lib/lane-dwell';
import {CardDwell} from './TicketCard';
import {IconLaneStats} from './IconLaneStats';
import {LaneSparkline} from './LaneSparkline';
import {LaneStayPoint} from '../../../lib/stats/swimlane-stats.model.js';
import {IconLock} from './IconLock';
import {Panel} from './Panel';
import {TicketCard} from './TicketCard';
import {Button} from './Button';
import {KebabMenu} from './KebabMenu';
import {SWIMLANE_DRAG_TYPE, isSwimlaneDrag} from '../lib/gui-move-swimlane';

// Not GUI_THEME.accent: at that hue a large soft wash reads cyan-green rather
// than blue, so this is desaturated toward the panel chrome's blue-grey.
const COLUMN_GLOW_COLOR = 'rgb(140, 176, 232)';

const COLUMN_PADDING = 14;
// Half the padding, so the scrollbar sits centred in the gutter. The two have
// to move together.
const SCROLLBAR_GUTTER_INSET = COLUMN_PADDING / 2;

export const SwimlaneColumn = ({
	swimlane,
	selected,
	selectedIssueId,
	onSelectIssueComments,
	commentsByIssueId,
	dragOver,
	dropIndex,
	onSelectIssue,
	isolatedTagId,
	onFilterByTag,
	pickedIssueIds,
	onCreateIssue,
	onRenameSwimlane,
	onDeleteSwimlane,
	dropSide,
	onSwimlaneDragOver,
	onSwimlaneDragEnd,
	onDropSwimlane,
	onDropIssue,
	onDragOver,
	onDragOverIssue,
	onDragLeave,
	theatre,
	live,
	statsOpen,
	onOpenStats,
	trend,
}: {
	swimlane: GuiSwimlane;
	selected: boolean;
	selectedIssueId: string | null;
	commentsByIssueId: Record<string, GuiComment[]>;
	dragOver: boolean;
	dropIndex: number | null;
	onSelectIssueComments: (nextIssueId: string) => void;
	onSelectIssue: (issueId: string, options: {toggle: boolean}) => void;
	isolatedTagId: string | null;
	onFilterByTag: (tagId: string) => void;
	pickedIssueIds: readonly string[];
	onCreateIssue: (swimlaneId: string) => void;
	onRenameSwimlane: (swimlaneId: string) => void;
	onDeleteSwimlane: (swimlaneId: string) => void;
	// Null unless the history player is up. `flashIssueId` is the ticket the
	// event that just landed happened to, and `flashKey` that event's id, which
	// is what restarts the flash when two of them in a row touch one ticket.
	theatre: {flashIssueId: string | null; flashKey: string | null} | null;
	// Which edge of this column the dragged swimlane would land on, if any.
	dropSide: 'left' | 'right' | null;
	onSwimlaneDragOver: (swimlaneId: string, side: 'left' | 'right') => void;
	onSwimlaneDragEnd: () => void;
	onDropSwimlane: (swimlaneId: string) => void;
	onDropIssue: (
		issueId: string,
		swimlaneId: string,
		targetIndex: number | 'end',
	) => void;
	onDragOver: (swimlaneId: string) => void;
	onDragOverIssue: (swimlaneId: string, targetIndex: number) => void;
	onDragLeave: () => void;
	// The board is showing the present. A dwell is time elapsed until now, which
	// says nothing about a board being replayed at some other moment.
	live: boolean;
	// This lane's stats are the ones the inspector is showing.
	statsOpen: boolean;
	onOpenStats: (swimlaneId: string) => void;
	// The lane's own stay curve, for the sparkline in its header. Empty until
	// the board's trends have arrived.
	trend: LaneStayPoint[];
}) => {
	// One reading for the whole column, so the header's figures and the clocks on
	// the cards under it are answers to the same question.
	// Real hover, not the curve's proximity glow: the glow reaches across a
	// couple of hundred pixels, and a frame drawn that far out would promise a
	// click on a column the pointer is nowhere near.
	const [statsHovered, setStatsHovered] = useState(false);

	const now = Date.now();
	const dwell = live ? laneDwell(swimlane.issues, now) : null;

	const cardDwell = (ticket: GuiIssue): CardDwell | null => {
		if (!dwell) return null;

		const ms = dwellOf(ticket, now);

		return {ms, level: dwellLevel(ms, dwell, swimlane.issues.length)};
	};

	return (
		<Panel
			as="section"
			active={dragOver}
			borderColor={selected || dragOver ? GUI_THEME.accent : GUI_THEME.line}
			// Tuned by eye: 0.15 was imperceptible, 0.6 distracting. The wide radius
			// keeps it a soft wash rather than a hotspot tracking the cursor, and the
			// reach lights a column up as a dragged ticket approaches from outside.
			glowColor={COLUMN_GLOW_COLOR}
			glowOpacity={0.41}
			glowRadius={370}
			proximityReach={200}
			style={{
				zIndex: 0,
				width: 360,
				minWidth: 360,
				// Fills the board row rather than guessing at the chrome above with a
				// viewport calc; the scrubber's height changes as it is used.
				height: '100%',
				// Panel's 1px border would otherwise add to the 100% and overflow the row.
				boxSizing: 'border-box',
				background: dragOver ? '#14202a' : GUI_THEME.bg,
				padding: `0 ${COLUMN_PADDING}px`,
				display: 'flex',
				flexDirection: 'column',
			}}
			onDragOver={event => {
				event.preventDefault();
				event.dataTransfer.dropEffect = 'move';

				// A swimlane crossing this column is being reordered, not dropped
				// into it. Its landing edge is decided by which half it is over.
				if (isSwimlaneDrag(event.dataTransfer)) {
					const rect = event.currentTarget.getBoundingClientRect();
					const side =
						event.clientX < rect.left + rect.width / 2 ? 'left' : 'right';

					return onSwimlaneDragOver(swimlane.id, side);
				}

				onDragOver(swimlane.id);

				if (dropIndex === null) {
					onDragOverIssue(swimlane.id, swimlane.issues.length);
				}
			}}
			onDragLeave={event => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
					onDragLeave();
				}
			}}
			// The dragged column keeps its normal look; the edge line marks where it
			// would land, which is the thing that is actually in question.
			data-drop-side={dropSide ?? undefined}
			onDrop={event => {
				event.preventDefault();
				event.stopPropagation();

				if (isSwimlaneDrag(event.dataTransfer)) {
					return onDropSwimlane(event.dataTransfer.getData(SWIMLANE_DRAG_TYPE));
				}

				const issueId = event.dataTransfer.getData('text/plain');
				if (!issueId) return;

				const targetIndex = dropIndex ?? swimlane.issues.length;

				onDropIssue(issueId, swimlane.id, targetIndex);
				onDragLeave();
			}}
		>
			{/* Absolute, so the edge line stays out of the column's layout and
			    cannot shift the cards mid-drag. */}
			{dropSide && (
				<div
					data-testid="swimlane-drop-indicator"
					style={{
						position: 'absolute',
						top: 8,
						bottom: 8,
						[dropSide]: -1,
						width: 2,
						borderRadius: 999,
						background: GUI_THEME.accent,
						boxShadow: `0 0 12px ${GUI_THEME.accent}`,
						zIndex: 2,
					}}
				/>
			)}

			<header
				draggable={!swimlane.readonly}
				data-testid="swimlane-handle"
				onDragStart={event => {
					event.stopPropagation();
					event.dataTransfer.effectAllowed = 'move';
					event.dataTransfer.setData(SWIMLANE_DRAG_TYPE, swimlane.id);
					// Firefox ignores a drag that sets no text/plain, but the ticket
					// handlers read that key — so it carries the id under its own type
					// and a marker here.
					event.dataTransfer.setData('text/plain', '');
				}}
				onDragEnd={onSwimlaneDragEnd}
				style={{
					height: 48,
					flexShrink: 0,
					display: 'flex',
					fontSize: 12,
					justifyContent: 'space-between',
					alignItems: 'center',
					cursor: swimlane.readonly ? 'default' : 'grab',
				}}
			>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 8,
						minWidth: 0,
					}}
				>
					<span
						style={{
							color: selected ? GUI_THEME.accent : GUI_THEME.secondary,
						}}
					>
						{selected ? '❯' : ' '}
					</span>

					<strong
						style={{
							color: selected ? GUI_THEME.accent : GUI_THEME.primary,
							// The lane's own figures are the fixed part of this row: a
							// title long enough to crowd them out is cut instead.
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
						}}
					>
						{swimlane.title}
					</strong>

					<span style={{color: GUI_THEME.dim}}>({swimlane.issues.length})</span>

					{swimlane.readonly && (
						<span
							title="Read-only"
							style={{display: 'flex', color: GUI_THEME.dim}}
						>
							<IconLock />
						</span>
					)}
				</div>

				{/* Its own section between the title and the buttons rather than
				    trailing the count, so the chart sits mid-header instead of
				    wherever the title happens to end. A middle that flexes cannot
				    collide with a long title the way a centred overlay would. */}
				<div
					style={{
						flex: 1,
						display: 'flex',
						justifyContent: 'center',
						alignItems: 'center',
						minWidth: 0,
					}}
				>
					{/* One control, not two beside each other: where the lane has a
					    curve the curve is the button, and where it has none — a lane
					    opened today, or one being drawn as it was mid-scrub — the icon
					    stands in, so the panel is never unreachable. */}
					{dwell && (
						<Button
							variant="ghost"
							data-testid="swimlane-stats-open"
							title={`Lane stats — tickets here have waited ${formatDuration(
								dwell.median,
							)} on average, the longest ${formatDuration(dwell.max)}`}
							onClick={event => {
								// Stopped here, or the header's own click would take the
								// selection with it.
								event.stopPropagation();
								onOpenStats(swimlane.id);
							}}
							onMouseEnter={() => setStatsHovered(true)}
							onMouseLeave={() => setStatsHovered(false)}
							style={{
								display: 'flex',
								alignItems: 'center',
								color: statsOpen ? GUI_THEME.accent : GUI_THEME.dim,
								flexShrink: 0,
								// A frame only under the pointer. The panel's own outer
								// edge rather than its inner `line`: a 1px box round a
								// small control needs the weight that holds a panel apart
								// from the board, not the one that divides sections
								// inside it.
								border: `1px solid ${
									statsHovered ? GUI_THEME.edge : 'transparent'
								}`,
								borderRadius: 4,
								background: 'transparent',
								padding: '2px 4px',
								transition: 'border-color 140ms ease',
							}}
						>
							{live && trend.length > 0 ? (
								<LaneSparkline points={trend} />
							) : (
								<IconLaneStats />
							)}
						</Button>
					)}
				</div>

				<div style={{display: 'flex', alignItems: 'center', gap: 2}}>
					<Button
						variant="ghost"
						onClick={() => onCreateIssue(swimlane.id)}
						disabled={swimlane.readonly}
						title="Add issue"
					>
						+
					</Button>

					{/* Absent rather than disabled on a readonly swimlane: every entry
					    behind it is a write, so the menu would open onto nothing. */}
					{!swimlane.readonly && (
						<KebabMenu
							testId="swimlane-menu"
							title="Swimlane actions"
							items={[
								{
									id: 'rename',
									label: 'rename',
									onSelect: () => onRenameSwimlane(swimlane.id),
								},
								{
									id: 'delete',
									label: 'delete',
									danger: true,
									onSelect: () => onDeleteSwimlane(swimlane.id),
								},
							]}
						/>
					)}
				</div>
			</header>

			{/* Pulling out by half the panel padding and giving the same back centres
			    the scrollbar in the gutter instead of leaving it flush against the
			    cards. */}
			<div
				style={{
					overflow: 'auto',
					paddingTop: 4,
					marginRight: -SCROLLBAR_GUTTER_INSET,
					paddingRight: SCROLLBAR_GUTTER_INSET,
					flex: 1,
					minHeight: 0,
				}}
			>
				{swimlane.issues.length === 0 ? (
					<>{/* Show nothing */}</>
				) : (
					<>
						{swimlane.issues.map((ticket, index) => (
							<React.Fragment key={ticket.id}>
								{dropIndex === index && <DropIndicator />}

								<TicketCard
									ticket={ticket}
									index={index}
									isSelected={ticket.id === selectedIssueId}
									isPicked={pickedIssueIds.includes(ticket.id)}
									onSelect={options => onSelectIssue(ticket.id, options)}
									onOpenComments={onSelectIssueComments}
									dwell={cardDwell(ticket)}
									isolatedTagId={isolatedTagId}
									onFilterByTag={onFilterByTag}
									commentCount={commentsByIssueId[ticket.id]?.length ?? 0}
									onDragOverIssue={targetIndex =>
										onDragOverIssue(swimlane.id, targetIndex)
									}
									onDropIssueAt={(issueId, targetIndex) => {
										onDropIssue(issueId, swimlane.id, targetIndex);
										onDragLeave();
									}}
									theatre={theatre !== null}
									flashKey={
										theatre && theatre.flashIssueId === ticket.id
											? theatre.flashKey
											: null
									}
								/>
							</React.Fragment>
						))}

						{dropIndex === swimlane.issues.length && <DropIndicator />}
					</>
				)}
			</div>
		</Panel>
	);
};
