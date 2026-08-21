import React from 'react';
import {DropIndicator} from '../App';
import {GuiComment, GuiSwimlane} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
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
}: {
	swimlane: GuiSwimlane;
	selected: boolean;
	selectedIssueId: string | null;
	commentsByIssueId: Record<string, GuiComment[]>;
	dragOver: boolean;
	dropIndex: number | null;
	onSelectIssueComments: (nextIssueId: string) => void;
	onSelectIssue: (issueId: string, options: {toggle: boolean}) => void;
	pickedIssueIds: readonly string[];
	onCreateIssue: (swimlaneId: string) => void;
	onRenameSwimlane: (swimlaneId: string) => void;
	onDeleteSwimlane: (swimlaneId: string) => void;
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
}) => {
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
				// Header rather than the whole column: the cards inside are draggable
				// too, and a draggable ancestor would make the pointer's exact
				// position decide which one starts.
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
					}}
				>
					<span
						style={{color: selected ? GUI_THEME.accent : GUI_THEME.secondary}}
					>
						{selected ? '❯' : ' '}
					</span>

					<strong
						style={{color: selected ? GUI_THEME.accent : GUI_THEME.primary}}
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
									commentCount={commentsByIssueId[ticket.id]?.length ?? 0}
									onDragOverIssue={targetIndex =>
										onDragOverIssue(swimlane.id, targetIndex)
									}
									onDropIssueAt={(issueId, targetIndex) => {
										onDropIssue(issueId, swimlane.id, targetIndex);
										onDragLeave();
									}}
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
