// A goal's panel, opened from its pill: how far along it is, and every
// ticket in it, on whichever board, each a way to that ticket.

import {useState} from 'react';
import {CLOSED_BOARD_ID} from '../../../lib/board/static-ids.js';
import {AsideDock} from '../lib/aside-dock';
import {GuiBoard, GuiGoal, GuiIssue} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {statGrid} from '../lib/issue-stats.style';
import {menuRowHoverBackground} from '../lib/select-style';
import {Aside} from './Aside';
import {Empty} from './FormPrimitives';
import {GoalProgressLine} from './GoalLabel';
import {CopyRef} from './CopyRef';
import {DetailsHeader} from './NodeDetails';
import {Section} from './Section';
import {Stat} from './StatRow';

type Member = {issue: GuiIssue; lane: string; done: boolean};
type Group = {board: GuiBoard; members: Member[]};

// Each ticket once, under the first board that shows it: this one, then the
// others by rank, the Closed board last. Open tickets lead each group.
const groupsOf = (
	goalId: string,
	boards: GuiBoard[],
	boardId: string,
): Group[] => {
	const found = new Map<string, {issue: GuiIssue; lane: string}>();
	for (const board of boards) {
		for (const lane of board.swimlanes) {
			for (const issue of lane.issues) {
				found.set(issue.id, {issue, lane: lane.title});
			}
		}
	}

	const rank = (board: GuiBoard) =>
		board.id === boardId ? 0 : board.id === CLOSED_BOARD_ID ? 2 : 1;
	const seen = new Set<string>();

	return [...boards]
		.sort((a, b) => rank(a) - rank(b))
		.map(board => {
			const shown = board.goals.find(goal => goal.id === goalId)?.members ?? [];
			const members = shown.flatMap(({id, done}) => {
				const at = found.get(id);
				if (!at || seen.has(id)) return [];
				seen.add(id);
				return [{...at, done}];
			});
			return {
				board,
				members: [
					...members.filter(member => !member.done),
					...members.filter(member => member.done),
				],
			};
		})
		.filter(group => group.members.length > 0);
};

// The ref copies, as a ticket panel's does; the rest of the row opens the
// ticket. Two buttons side by side, as one cannot hold the other.
const MemberRow = ({member, onOpen}: {member: Member; onOpen: () => void}) => {
	const [hovered, setHovered] = useState(false);

	return (
		<div
			data-testid="goal-member"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				display: 'flex',
				alignItems: 'baseline',
				gap: 8,
				borderRadius: 6,
				padding: '6px 8px',
				fontSize: 11,
				background: hovered ? menuRowHoverBackground : 'transparent',
			}}
		>
			<span style={{flexShrink: 0}}>
				<CopyRef refValue={member.issue.ref} />
			</span>
			<button
				type="button"
				data-testid="goal-member-open"
				onClick={onOpen}
				style={{
					display: 'flex',
					alignItems: 'baseline',
					justifyContent: 'space-between',
					gap: 10,
					flex: 1,
					minWidth: 0,
					padding: 0,
					border: 'none',
					background: 'transparent',
					font: 'inherit',
					textAlign: 'left',
					cursor: 'pointer',
				}}
			>
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
				<span style={{color: GUI_THEME.dim, flexShrink: 0}}>{member.lane}</span>
			</button>
		</div>
	);
};

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
	const groups = groupsOf(goal.id, boards, boardId);
	const share = goal.total > 0 ? goal.done / goal.total : 0;
	const here =
		boards
			.find(board => board.id === boardId)
			?.goals.find(shown => shown.id === goal.id)?.members.length ?? 0;

	const row = (board: GuiBoard) => (member: Member) =>
		(
			<MemberRow
				key={member.issue.id}
				member={member}
				onOpen={() => onOpenIssue(member.issue.id, board.ref)}
			/>
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
						value={String(here)}
						testId="goal-details-here"
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

			{groups.length === 0 && (
				<Section title="Tickets">
					<Empty>No tickets yet</Empty>
				</Section>
			)}

			{groups.map(({board, members}) => (
				<Section
					key={board.id}
					title={
						board.id === boardId
							? 'On this board'
							: board.id === CLOSED_BOARD_ID
							? 'Closed'
							: `On ${board.title}`
					}
				>
					<div data-testid="goal-group" style={{marginTop: 8}}>
						{members.map(row(board))}
					</div>
				</Section>
			))}
		</Aside>
	);
};
