// A goal is a name on a board that tickets belong to, one goal per ticket.
// It sits in no lane: how far along it is comes from its tickets.

import {ulid} from 'ulid';
import {actorOf, AppEvent} from '../../lib/board/board-events.model.js';
import {materializeAndPersistAll} from '../../lib/board/board-log.js';
import {Goal} from '../../lib/model/app-state.model.js';
import {Ticket} from '../../lib/model/context.model.js';
import {failed, isFail, succeeded} from '../../lib/model/result-types.js';
import {
	boardGoals,
	findTicketGoal,
	getGoal,
	goalBoardRefusal,
	goalName,
	newGoalRefusal,
	getTicketGoal,
	goalColor,
	goalNameRefusal,
	goalProgress,
	ticketBoardId,
} from '../../lib/utils/goal.utils.js';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {sanitizeInlineText} from '../../lib/utils/string.utils.js';
import {ApiGoal, ApiGoalRef} from '../api-state.model.js';
import {bootedWithActorAndState, ToolInput} from './boot.js';
import {findWritableIssue} from './node-targets.js';

const goalRef = (goal: Goal): ApiGoalRef => ({
	id: goal.id,
	name: sanitizeInlineText(goal.name),
	color: goalColor(goal),
});

/** What a ticket carries about its goal, for every projection of it. */
export const goalFields = (ticket: Ticket) => {
	const goal = getTicketGoal(ticket);
	return goal ? {goal: goalRef(goal)} : {};
};

/** A board's goals, each with how far along its tickets are. */
export const apiBoardGoals = (boardId: string): ApiGoal[] =>
	boardGoals(boardId).map(goal => ({
		...goalRef(goal),
		...goalProgress(goal.id),
	}));

const persist = (
	stateBranchRoot: string,
	events: AppEvent[],
	saved: {id: string; name: string},
) => {
	const results = materializeAndPersistAll(events, stateBranchRoot);
	if (isFail(results)) return failed(results.message);

	return succeeded('Saved', saved);
};

/**
 * Puts a ticket in one of its board's goals, by id or name, making a goal of
 * that name when there is none; null takes it out.
 */
export const setIssueGoal = async (
	input: ToolInput & {issueId: string; goal: string | null},
) => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const issueResult = findWritableIssue(input.issueId);
	if (isFail(issueResult)) return issueResult;
	const issue = issueResult.value;
	const saved = {id: issue.id, ref: nodeRef(issue.id)};

	let goalId: string | undefined;
	if (input.goal !== null) {
		const goal = findTicketGoal(issue, input.goal);
		if (!goal && getGoal(input.goal)) {
			return failed('That goal is on another board');
		}
		if (!goal) {
			const refusal = newGoalRefusal(issue, input.goal);
			if (refusal) return failed(refusal);

			const created = await createGoal({
				repoRoot: input.repoRoot,
				boardId: ticketBoardId(issue) ?? '',
				name: input.goal,
				issueId: issue.id,
			});
			// Said, so a mistyped name is seen to have made a goal.
			return isFail(created)
				? created
				: succeeded(`Created goal "${created.value.name}"`, saved);
		}
		goalId = goal.id;
	}

	if (issue.props.goal === goalId) return succeeded('No changes made', saved);

	const results = materializeAndPersistAll(
		[
			{
				id: ulid(),
				...actorOf(ready.value.actor),
				action: 'set.issue.goal',
				payload: goalId ? {id: issue.id, goal: goalId} : {id: issue.id},
			},
		],
		ready.value.boot.stateBranchRoot,
	);
	if (isFail(results)) return failed(results.message);

	return succeeded('Saved', saved);
};

/** A new goal on a board, and the ticket named, if any, put in it at once. */
export const createGoal = async (
	input: ToolInput & {boardId: string; name: string; issueId?: string},
) => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const boardRefusal = goalBoardRefusal(input.boardId);
	if (boardRefusal) return failed(boardRefusal);

	const name = goalName(input.name);
	const refusal = goalNameRefusal(input.boardId, name);
	if (refusal) return failed(refusal);

	const actor = actorOf(ready.value.actor);
	const id = ulid();
	const events: AppEvent[] = [
		{
			id,
			...actor,
			action: 'create.goal',
			payload: {id, name, board: input.boardId},
		},
	];

	if (input.issueId) {
		const issueResult = findWritableIssue(input.issueId);
		if (isFail(issueResult)) return issueResult;
		const issue = issueResult.value;
		if (ticketBoardId(issue) !== input.boardId) {
			return failed(`${nodeRef(issue.id)} is not on that board`);
		}

		events.push({
			id: ulid(),
			...actor,
			action: 'set.issue.goal',
			payload: {id: issue.id, goal: id},
		});
	}

	return persist(ready.value.boot.stateBranchRoot, events, {id, name});
};

export const renameGoal = async (
	input: ToolInput & {goalId: string; name: string},
) => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const goal = getGoal(input.goalId);
	if (!goal) return failed('Goal not found');

	const boardRefusal = goalBoardRefusal(goal.board);
	if (boardRefusal) return failed(boardRefusal);

	const name = goalName(input.name);
	if (name === goal.name) {
		return succeeded('No changes made', {id: goal.id, name});
	}

	const refusal = goalNameRefusal(goal.board, name, goal.id);
	if (refusal) return failed(refusal);

	return persist(
		ready.value.boot.stateBranchRoot,
		[
			{
				id: ulid(),
				...actorOf(ready.value.actor),
				action: 'rename.goal',
				payload: {id: goal.id, name},
			},
		],
		{id: goal.id, name},
	);
};

/** Removes a goal; its tickets stay where they are, in no goal. */
export const removeGoal = async (input: ToolInput & {goalId: string}) => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const goal = getGoal(input.goalId);
	if (!goal) return failed('Goal not found');

	const boardRefusal = goalBoardRefusal(goal.board);
	if (boardRefusal) return failed(boardRefusal);

	return persist(
		ready.value.boot.stateBranchRoot,
		[
			{
				id: ulid(),
				...actorOf(ready.value.actor),
				action: 'tombstone.goal',
				payload: {id: goal.id},
			},
		],
		{id: goal.id, name: goal.name},
	);
};
