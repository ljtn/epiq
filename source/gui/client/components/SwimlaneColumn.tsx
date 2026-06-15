import React from 'react';
import {DropIndicator} from '../App';
import {GuiComment, GuiSwimlane} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {Panel} from './Panel';
import {TicketCard} from './TicketCard';
import {Button} from './Button';

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
				height: 'calc(100vh - 160px)',
				background: dragOver ? '#14202a' : GUI_THEME.bg,
				padding: '0 14px',
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

			<div style={{overflow: 'auto', paddingTop: 4, flex: 1}}>
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
