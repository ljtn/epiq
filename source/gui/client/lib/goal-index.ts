// Which tickets are goals, and how far along each is. A ticket is a goal
// by having tickets that belong to it, so this is read off the board's state,
// never stored: the members say so.

import {GuiIssue, GuiState} from './gui-state.model';

export type GoalSummary = {
	id: string;
	color: string;
	members: GuiIssue[];
	// Closed, or standing in a lane called Done.
	done: number;
};

export type GoalIndex = ReadonlyMap<string, GoalSummary>;

export const EMPTY_GOALS: GoalIndex = new Map();

/** Every ticket on every board, closed ones included. */
export const allIssues = (state: GuiState): GuiIssue[] =>
	state.boards.flatMap(board => board.swimlanes.flatMap(lane => lane.issues));

export const buildGoalIndex = (state: GuiState): GoalIndex => {
	// By name, not by place: lanes are in whatever order a team put them.
	const doneLaneIds = new Set(
		state.boards.flatMap(board =>
			board.swimlanes
				.filter(lane => lane.title.trim().toLowerCase() === 'done')
				.map(lane => lane.id),
		),
	);
	const laneOf = new Map(
		state.boards.flatMap(board =>
			board.swimlanes.flatMap(lane =>
				lane.issues.map(issue => [issue.id, lane.id] as const),
			),
		),
	);

	const index = new Map<string, GoalSummary>();

	for (const issue of allIssues(state)) {
		const goal = issue.goal;
		if (!goal) continue;

		const summary = index.get(goal.id) ?? {
			id: goal.id,
			color: goal.color,
			members: [],
			done: 0,
		};

		summary.members.push(issue);
		if (issue.isClosed || doneLaneIds.has(laneOf.get(issue.id) ?? '')) {
			summary.done++;
		}

		index.set(goal.id, summary);
	}

	return index;
};
