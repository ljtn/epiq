// A goal is a name in the project that tickets belong to, one goal each as
// set here; how far along it is comes from its tickets.

import {ulid} from 'ulid';
import {actorOf, AppEvent} from '../../lib/board/board-events.model.js';
import {materializeAndPersistAll} from '../../lib/board/board-log.js';
import {Goal} from '../../lib/model/app-state.model.js';
import {Ticket} from '../../lib/model/context.model.js';
import {failed, isFail, succeeded} from '../../lib/model/result-types.js';
import {
	boardGoals,
	findGoal,
	getGoal,
	goalName,
	getTicketGoal,
	oneGoalChanges,
	goalColor,
	goalBoards,
	goalMembersOn,
	isGoalTicketDone,
	goalNameRefusal,
	goalProgress,
	projectGoals,
} from '../../lib/utils/goal.utils.js';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {sanitizeInlineText} from '../../lib/utils/string.utils.js';
import {ApiBoardGoal, ApiGoal, ApiGoalRef} from '../api-state.model.js';
import {bootedWithActorAndState, bootLocal, ToolInput} from './boot.js';
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

const apiGoal = (goal: Goal): ApiGoal => ({
	...goalRef(goal),
	...goalProgress(goal.id),
	...(goal.description && {description: goal.description}),
});

/** The project's goals, each with how far along its tickets are. */
export const apiGoals = (): ApiGoal[] => projectGoals().map(apiGoal);

/** Every goal in the project, and the boards its tickets are on. */
export const listGoals = async (input: ToolInput = {}) => {
	const booted = await bootLocal(input.repoRoot);
	if (isFail(booted)) return booted;

	return succeeded(
		'Listed goals',
		projectGoals().map(goal => ({
			...apiGoal(goal),
			boards: goalBoards(goal.id).map(id => ({id, ref: nodeRef(id)})),
		})),
	);
};

/** The goals a board shows, and which of each one's tickets it shows. */
export const apiBoardGoals = (boardId: string): ApiBoardGoal[] =>
	// Without the description: it would go out once per board in every state.
	boardGoals(boardId).map(goal => ({
		...goalRef(goal),
		...goalProgress(goal.id),
		members: goalMembersOn(goal.id, boardId).map(ticket => ({
			id: ticket.id,
			done: isGoalTicketDone(ticket),
		})),
	}));

const persist = <T>(stateBranchRoot: string, events: AppEvent[], saved: T) => {
	const results = materializeAndPersistAll(events, stateBranchRoot);
	if (isFail(results)) return failed(results.message);

	return succeeded('Saved', saved);
};

/**
 * Puts a ticket in a goal, by id or name, making a goal of that name when
 * there is none; null takes it out.
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
		const goal = findGoal(input.goal);
		if (!goal) {
			const created = await createGoal({
				repoRoot: input.repoRoot,
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

	const changes = oneGoalChanges(issue, goalId);
	if (changes.length === 0) return succeeded('No changes made', saved);

	const actor = actorOf(ready.value.actor);
	return persist(
		ready.value.boot.stateBranchRoot,
		changes.map(change => ({id: ulid(), ...actor, ...change})),
		saved,
	);
};

/** A new goal, and the ticket named, if any, put in it at once. */
export const createGoal = async (
	input: ToolInput & {name: string; issueId?: string},
) => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const name = goalName(input.name);
	const refusal = goalNameRefusal(name);
	if (refusal) return failed(refusal);

	const actor = actorOf(ready.value.actor);
	const id = ulid();
	const events: AppEvent[] = [
		{
			id,
			...actor,
			action: 'create.goal',
			payload: {id, name},
		},
	];

	if (input.issueId) {
		const issueResult = findWritableIssue(input.issueId);
		if (isFail(issueResult)) return issueResult;
		const issue = issueResult.value;

		for (const change of oneGoalChanges(issue, id)) {
			events.push({id: ulid(), ...actor, ...change});
		}
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

	const name = goalName(input.name);
	if (name === goal.name) {
		return succeeded('No changes made', {id: goal.id, name});
	}

	const refusal = goalNameRefusal(name, goal.id);
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
