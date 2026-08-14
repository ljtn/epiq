import React from 'react';
import {DropIndicator} from '../App';
import {GuiComment, GuiSwimlane} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {Panel} from './Panel';
import {TicketCard} from './TicketCard';
import {Button} from './Button';

// The column's own horizontal padding, and half of it — the amount the
// scrolling list is pulled out by so its scrollbar ends up centered in that
// padding rather than flush against the cards. Kept as constants so the two
// stay in step: changing the padding without changing the inset would put the
// scrollbar off-centre again.
const COLUMN_PADDING = 14;
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
	onSelectIssue: (issueId: string) => void;
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
			glowOpacity={0.15}
			style={{
				zIndex: 0,
				width: 360,
				minWidth: 360,
				// Fills whatever height the board row has, rather than deriving it
				// from the viewport. The old `calc(100vh - 160px)` hardcoded a
				// guess at the chrome above — header, scrubber, board picker — and
				// the scrubber alone changes height when collapsed or switched
				// between modes, so the guess was routinely wrong and the columns
				// overflowed the page, adding a second scrollbar beside their own.
				height: '100%',
				// Panel draws a 1px border, which content-box sizing would add on
				// top of the 100% — leaving the column 2px taller than the row and
				// overflowing it by exactly that.
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

					{swimlane.readonly && <span>🔒</span>}
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

			{/* The scrollbar sits at this box's right padding edge, so the space
			    on either side of it comes from two different places: to its left,
			    this element's own paddingRight; to its right, whatever of the
			    Panel's 14px padding it hasn't been pulled into. Left flush against
			    the cards otherwise — it rendered hard up against them with the
			    full 14px stranded on the far side. Pulling out by half the panel
			    padding and giving back the same amount centers it in that gutter. */}
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
									onSelect={() => onSelectIssue(ticket.id)}
									onDragStart={issueId => onSelectIssue(issueId)}
									onOpenComments={onSelectIssueComments}
									commentCount={commentsByIssueId[ticket.id].length ?? 0}
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
