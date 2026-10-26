// A goal's panel, opened from its pill: how far along it is, and every
// ticket in it, on whichever board, each a way to that ticket.

import {AsideDock} from '../lib/aside-dock';
import {GuiBoard, GuiGoal, GuiIssue} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {statGrid} from '../lib/issue-stats.style';
import {Aside} from './Aside';
import {Empty} from './FormPrimitives';
import {GoalProgressLine} from './GoalLabel';
import {MenuItem} from './Menu';
import {DetailsHeader} from './NodeDetails';
import {Section} from './Section';
import {Stat} from './StatRow';

type Member = {issue: GuiIssue; board: GuiBoard; lane: string; done: boolean};

// The same rule the server counts by: closed, or in a lane called Done.
const membersOf = (goalId: string, boards: GuiBoard[]): Member[] =>
	boards.flatMap(board =>
		board.swimlanes.flatMap(lane =>
			lane.issues
				.filter(issue => issue.goal?.id === goalId)
				.map(issue => ({
					issue,
					board,
					lane: lane.title,
					done: issue.isClosed || lane.title.trim().toLowerCase() === 'done',
				})),
		),
	);

export const GoalDetails = ({
	dock,
	goal,
	boards,
	boardId,
	onOpenIssue,
	onClose,
}: {
	dock: AsideDock;
	goal: GuiGoal;
	boards: GuiBoard[];
	// The board on screen, whose tickets come first.
	boardId: string;
	onOpenIssue: (issueId: string, boardRef: string) => void;
	onClose: () => void;
}) => {
	const members = membersOf(goal.id, boards);
	const share = goal.total > 0 ? goal.done / goal.total : 0;
	const here = members.filter(member => member.board.id === boardId);
	const elsewhere = members.filter(member => member.board.id !== boardId);

	const row = (member: Member) => (
		<MenuItem
			key={member.issue.id}
			testId="goal-member"
			onSelect={() => onOpenIssue(member.issue.id, member.board.ref)}
		>
			<span
				style={{
					display: 'flex',
					alignItems: 'baseline',
					gap: 8,
					minWidth: 0,
					flex: 1,
				}}
			>
				<span style={{fontSize: 11, color: GUI_THEME.dim, flexShrink: 0}}>
					{member.issue.ref}
				</span>
				<span
					style={{
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
						color: member.done ? GUI_THEME.dim : GUI_THEME.primarySoft,
						textDecoration: member.issue.isClosed ? 'line-through' : undefined,
					}}
				>
					{member.issue.title}
				</span>
			</span>
			<span style={{fontSize: 11, color: GUI_THEME.dim, flexShrink: 0}}>
				{member.lane}
			</span>
		</MenuItem>
	);

	return (
		<Aside dock={dock}>
			<DetailsHeader
				testId="goal-details"
				kind="Goal"
				title={goal.name}
				onClose={onClose}
			/>

			<Section title="Progress">
				<div style={statGrid(3, 3)}>
					<Stat
						size="compact"
						value={`${goal.done}/${goal.total}`}
						label="Done"
						testId="goal-details-done"
					/>
					<Stat
						size="compact"
						value={`${Math.round(share * 100)}%`}
						label="Of the goal"
					/>
					<Stat
						size="compact"
						value={String(here.length)}
						label="On this board"
					/>
				</div>
				<GoalProgressLine
					color={goal.color}
					share={share}
					thickness={4}
					style={{marginTop: 16}}
				/>
			</Section>

			{members.length === 0 && (
				<Section title="Tickets">
					<Empty>No tickets yet</Empty>
				</Section>
			)}

			{here.length > 0 && (
				<Section title="On this board">
					<div style={{marginTop: 8}}>{here.map(row)}</div>
				</Section>
			)}

			{/* Grouped by board, the board named once. */}
			{[...new Set(elsewhere.map(member => member.board))].map(board => (
				<Section key={board.id} title={`On ${board.title}`}>
					<div style={{marginTop: 8}}>
						{elsewhere.filter(member => member.board === board).map(row)}
					</div>
				</Section>
			))}
		</Aside>
	);
};
