// Which tickets are goals, and how far along each is. A ticket is a goal
// by having tickets that belong to it, so this is read off the board's state,
// never stored: the server counts each goal's tickets, the state lists them.

import {GuiIssue, GuiState} from './gui-state.model';

export type GoalSummary = {
	id: string;
	color: string;
	// The ones this state holds: closed tickets past its window are left out.
	members: GuiIssue[];
	// Over every ticket in it, as the server counts them.
	done: number;
	total: number;
};

export type GoalIndex = ReadonlyMap<string, GoalSummary>;

export const EMPTY_GOALS: GoalIndex = new Map();

/** Every ticket on every board, closed ones included. */
export const allIssues = (state: GuiState): GuiIssue[] =>
	state.boards.flatMap(board => board.swimlanes.flatMap(lane => lane.issues));

export const buildGoalIndex = (state: GuiState): GoalIndex => {
	const index = new Map<string, GoalSummary>();
	const entry = (id: string, color: string) => {
		const summary = index.get(id) ?? {
			id,
			color,
			members: [],
			done: 0,
			total: 0,
		};
		index.set(id, summary);
		return summary;
	};

	for (const issue of allIssues(state)) {
		if (issue.asGoal)
			Object.assign(entry(issue.id, issue.asGoal.color), issue.asGoal);
		if (issue.goal) entry(issue.goal.id, issue.goal.color).members.push(issue);
	}

	// A goal whose own ticket this state left out counts what it holds.
	for (const summary of index.values()) {
		if (summary.total > 0) continue;
		summary.total = summary.members.length;
		summary.done = summary.members.filter(member => member.isClosed).length;
	}

	return index;
};
