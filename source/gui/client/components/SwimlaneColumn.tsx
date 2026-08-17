import React from 'react';
import {DropIndicator} from '../App';
import {GuiComment, GuiSwimlane} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {IconLock} from './IconLock';
import {Panel} from './Panel';
import {TicketCard} from './TicketCard';
import {Button} from './Button';

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
			onDrop={event => {
				event.preventDefault();
				event.stopPropagation();

				const issueId = event.dataTransfer.getData('text/plain');
				if (!issueId) return;

				const targetIndex = dropIndex ?? swimlane.issues.length;

				onDropIssue(issueId, swimlane.id, targetIndex);
				onDragLeave();
			}}
		>
			<header
				style={{
					height: 48,
					flexShrink: 0,
					display: 'flex',
					fontSize: 12,
					justifyContent: 'space-between',
					alignItems: 'center',
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
				<div>
					<Button
						variant="ghost"
						onClick={() => onCreateIssue(swimlane.id)}
						disabled={swimlane.readonly}
						title="Add issue"
					>
						+
					</Button>
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
					<>
						{dropIndex === 0 && <DropIndicator />}

						<div
							style={{
								padding: 24,
								textAlign: 'center',
								color: GUI_THEME.dim,
								fontSize: 12,
							}}
						>
							Drop issue here
						</div>
					</>
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
