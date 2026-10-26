// A goal's code: every commit of every ticket in it, listed for its Code tab
// and measured for its Stats tab, from the one list so the two agree. Reads
// the materialized state, like the lane stats, so it stays correct mid-scrub.

import {
	getCommitsForRefs,
	RefsCommitEntry,
	withCommitBodies,
} from '../../lib/commits/commits.js';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../../lib/model/result-types.js';
import {IssueStats} from '../../lib/stats/issue-stats.model.js';
import {findGoal, goalMembers} from '../../lib/utils/goal.utils.js';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {getRefsStats} from '../epiq-issue-stats.js';
import {bootLocal, getStateResult} from './boot.js';
import {withCommitAuthors} from './commit-authors.js';

type GoalCodeInput = {repoRoot: string; goal: string; end?: number};

const goalRefs = (goal: string): Result<{id: string; refs: string[]}> => {
	const state = getStateResult();
	if (isFail(state)) return state;

	const found = findGoal(goal);
	if (!found) return failed(`No goal called or with the id "${goal}"`);

	return succeeded('Found goal', {
		id: found.id,
		refs: goalMembers(found.id).map(ticket => nodeRef(ticket.id)),
	});
};

export const getGoalStats = async (
	input: GoalCodeInput,
): Promise<Result<IssueStats>> => {
	const goal = goalRefs(input.goal);
	if (isFail(goal)) return goal;

	return getRefsStats({
		repoRoot: input.repoRoot,
		label: goal.value.id,
		refs: goal.value.refs,
		end: input.end,
	});
};

/** Newest first, each naming the goal's tickets it carries. */
export const getGoalCommits = async (
	input: GoalCodeInput,
): Promise<Result<Array<RefsCommitEntry & {body?: string}>>> => {
	const goal = goalRefs(input.goal);
	if (isFail(goal)) return goal;

	// With bodies and resolved authors, as a ticket's Code tab has them.
	return withCommitBodies(
		input.repoRoot,
		withCommitAuthors(
			await getCommitsForRefs({
				repoRoot: input.repoRoot,
				refs: goal.value.refs,
				end: input.end,
			}),
		),
	);
};

/** The MCP's door, which boots the project first. */
export const goalStats = async (input: {repoRoot?: string; goal: string}) => {
	const booted = await bootLocal(input.repoRoot);
	if (isFail(booted)) return booted;

	return getGoalStats({repoRoot: booted.value.repoRoot, goal: input.goal});
};
