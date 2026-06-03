import React from 'react';
import {DropIndicator} from '../App';
import {GuiSwimlane} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {TicketCard} from './TicketCard';

export const SwimlaneColumn = ({
	swimlane,
	selected,
	selectedIssueId,
	dragOver,
	dropIndex,
	onSelectIssue,
	onDropIssue,
	onDragOver,
	onDragOverIssue,
	onDragLeave,
}: {
	swimlane: GuiSwimlane;
	selected: boolean;
	selectedIssueId: string | null;
	dragOver: boolean;
	dropIndex: number | null;
	onSelectIssue: (issueId: string) => void;
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
		<section
			onDragOver={event => {
				event.preventDefault();
				event.dataTransfer.dropEffect = 'move';

				onDragOver(swimlane.id);

				if (swimlane.issues.length === 0) {
					onDragOverIssue(swimlane.id, 0);
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

				onDropIssue(issueId, swimlane.id, dropIndex ?? 'end');
				onDragLeave();
			}}
			style={{
				width: 360,
				minWidth: 360,
				height: 'calc(100vh - 128px)',
				background: dragOver ? '#14202a' : 'rgb(17 20 27 / 0%)',
				border: `1px solid ${
					selected || dragOver ? GUI_THEME.accent : GUI_THEME.line
				}`,
				borderRadius: 14,
				padding: '0 14px',
				display: 'flex',
				flexDirection: 'column',
			}}
		>
			<header
				style={{
					height: 48,
					display: 'flex',
					fontSize: 12,
					alignItems: 'center',
					gap: 8,
					borderBottom: `1px solid ${GUI_THEME.line}`,
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

				<span style={{color: GUI_THEME.secondary}}>
					({swimlane.issues.length})
				</span>

				{swimlane.readonly && <span>🔒</span>}
			</header>

			<div style={{overflow: 'auto', paddingTop: 4, flex: 1}}>
				{swimlane.issues.length === 0 ? (
					<>
						{dropIndex === 0 && <DropIndicator />}

						<div
							style={{
								padding: 24,
								textAlign: 'center',
								color: GUI_THEME.secondary,
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
		</section>
	);
};
