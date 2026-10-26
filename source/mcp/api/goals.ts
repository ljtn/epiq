// A goal is a ticket standing for a bigger thing other tickets belong to:
// it has its own description, comments and status, and its title names it.
// A ticket belongs to one goal at most, one level deep, so the mark it
// carries is never ambiguous; tags stay the way to say several things.

import {ulid} from 'ulid';
import {actorOf, AppEvent} from '../../lib/board/board-events.model.js';
import {materializeAndPersistAll} from '../../lib/board/board-log.js';
import {CLOSED_SWIMLANE_ID} from '../../lib/board/static-ids.js';
import {Ticket} from '../../lib/model/context.model.js';
import {failed, isFail, succeeded} from '../../lib/model/result-types.js';
import {
	goalColor,
	goalRefusal,
	findTicket,
	getTicketGoal,
	goalMembers,
	goalProgress,
} from '../../lib/utils/goal.utils.js';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {sanitizeInlineText} from '../../lib/utils/string.utils.js';
import {ApiGoalRef} from '../api-state.model.js';
import {Actor, bootedWithActorAndState, ToolInput} from './boot.js';
import {findWritableIssue} from './node-targets.js';
import {createIssue} from './issues.js';

/** The goal a ticket belongs to, as it reads now, or none. */
export const getIssueGoal = (ticket: Ticket): ApiGoalRef | undefined => {
	const goal = getTicketGoal(ticket);
	if (!goal) return undefined;

	return {
		id: goal.id,
		ref: nodeRef(goal.id),
		title: sanitizeInlineText(goal.title),
		color: goalColor(goal),
	};
};

/** What a ticket carries about goals, for every projection of it. */
export const goalFields = (ticket: Ticket) => {
	const goal = getIssueGoal(ticket);
	const progress = goalProgress(ticket.id);

	return {
		...(goal ? {goal} : {}),
		...(progress ? {asGoal: {color: goalColor(ticket), ...progress}} : {}),
	};
};

type Ready = {actor: Actor; boot: {stateBranchRoot: string}};

const persist = (
	ready: Ready,
	issueId: string,
	event: AppEvent<'set.issue.goal'>,
) => {
	const results = materializeAndPersistAll([event], ready.boot.stateBranchRoot);
	if (isFail(results)) return failed(results.message);

	return succeeded('Saved', {id: issueId, ref: nodeRef(issueId)});
};

export const setIssueGoal = async (
	input: ToolInput & {issueId: string; goal: string | null},
) => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const issueResult = findWritableIssue(input.issueId);
	if (isFail(issueResult)) return issueResult;
	const issue = issueResult.value;

	if (input.goal === null) {
		if (!issue.props.goal) {
			return succeeded('No changes made', {
				id: issue.id,
				ref: nodeRef(issue.id),
			});
		}

		return persist(ready.value, issue.id, {
			id: ulid(),
			...actorOf(ready.value.actor),
			action: 'set.issue.goal',
			payload: {id: issue.id},
		});
	}

	const goal = findTicket(input.goal);
	if (!goal) return failed('Goal ticket not found');

	const refusal = goalRefusal(issue, goal);
	if (refusal) return failed(refusal);

	if (issue.props.goal === goal.id) {
		return succeeded('No changes made', {id: issue.id, ref: nodeRef(issue.id)});
	}

	return persist(ready.value, issue.id, {
		id: ulid(),
		...actorOf(ready.value.actor),
		action: 'set.issue.goal',
		payload: {id: issue.id, goal: goal.id},
	});
};

/**
 * A new goal for a ticket: a ticket of its own, filed in the same lane, that
 * the ticket then belongs to.
 */
export const createIssueGoal = async (
	input: ToolInput & {issueId: string; title: string},
) => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const issueResult = findWritableIssue(input.issueId);
	if (isFail(issueResult)) return issueResult;
	const issue = issueResult.value;

	if (goalMembers(issue.id).length > 0) {
		return failed(`${nodeRef(issue.id)} is a goal; it is in none itself`);
	}
	if (issue.parentNodeId === CLOSED_SWIMLANE_ID) {
		return failed(
			`${nodeRef(issue.id)} is closed; reopen it to start a goal from it`,
		);
	}

	// Two writes, but every refusal the second could give is checked above,
	// so only a failed disk write leaves the new ticket outside its goal.
	const created = await createIssue({
		repoRoot: input.repoRoot,
		title: input.title,
		parentId: issue.parentNodeId!,
	});
	if (isFail(created)) return created;

	return setIssueGoal({
		repoRoot: input.repoRoot,
		issueId: issue.id,
		goal: created.value.id,
	});
};

/**
 * Takes every ticket out of a goal, in one write. The goal's own ticket
 * stays where it is: it was a ticket before anything belonged to it.
 */
export const dissolveGoal = async (input: ToolInput & {goalId: string}) => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const goal = findTicket(input.goalId);
	if (!goal) return failed('Goal ticket not found');

	const members = goalMembers(goal.id).filter(member => !member.readonly);
	const kept = goalMembers(goal.id).filter(member => member.readonly);
	// Read-only tickets stay in it, so the goal does too; say which.
	const keptNote =
		kept.length > 0
			? `; ${kept
					.map(member => nodeRef(member.id))
					.join(', ')} read-only, still in it`
			: '';
	if (members.length === 0) {
		return succeeded(`No changes made${keptNote}`, {
			id: goal.id,
			ref: nodeRef(goal.id),
		});
	}

	const results = materializeAndPersistAll(
		members.map(member => ({
			id: ulid(),
			...actorOf(ready.value.actor),
			action: 'set.issue.goal' as const,
			payload: {id: member.id},
		})),
		ready.value.boot.stateBranchRoot,
	);
	if (isFail(results)) return failed(results.message);

	return succeeded(`Saved${keptNote}`, {id: goal.id, ref: nodeRef(goal.id)});
};
