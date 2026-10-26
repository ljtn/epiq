// A goal's code stats: a ticket's Stats tab, over every commit of every ticket
// in the goal. Reads the materialized state, like the lane stats, so it stays
// correct mid-scrub.

import {failed, isFail, Result} from '../../lib/model/result-types.js';
import {IssueStats} from '../../lib/stats/issue-stats.model.js';
import {findGoal, goalMembers} from '../../lib/utils/goal.utils.js';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {getRefsStats} from '../epiq-issue-stats.js';
import {bootLocal, getStateResult} from './boot.js';

export const getGoalStats = async (input: {
	repoRoot: string;
	goal: string;
	end?: number;
}): Promise<Result<IssueStats>> => {
	const state = getStateResult();
	if (isFail(state)) return state;

	const goal = findGoal(input.goal);
	if (!goal) return failed(`No goal called or with the id "${input.goal}"`);

	return getRefsStats({
		repoRoot: input.repoRoot,
		label: goal.id,
		refs: goalMembers(goal.id).map(ticket => nodeRef(ticket.id)),
		end: input.end,
	});
};

/** The MCP's door, which boots the project first. */
export const goalStats = async (input: {repoRoot?: string; goal: string}) => {
	const booted = await bootLocal(input.repoRoot);
	if (isFail(booted)) return booted;

	return getGoalStats({repoRoot: booted.value.repoRoot, goal: input.goal});
};
