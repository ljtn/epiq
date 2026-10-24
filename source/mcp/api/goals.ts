// A goal is a ticket standing for a bigger thing other tickets belong to:
// it has its own description, comments and status, and its title names it.
// A ticket belongs to one goal at most, one level deep, so the mark it
// carries is never ambiguous; tags stay the way to say several things.

import {ulid} from 'ulid';
import {actorOf, AppEvent} from '../../lib/board/board-events.model.js';
import {materializeAndPersistAll} from '../../lib/board/board-log.js';
import {Ticket} from '../../lib/model/context.model.js';
import {failed, isFail, succeeded} from '../../lib/model/result-types.js';
import {HEX_COLOR} from '../../lib/utils/color.js';
import {
	goalColor,
	goalRefusal,
	findTicket,
	getTicketGoal,
} from '../../lib/utils/goal.utils.js';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {sanitizeInlineText} from '../../lib/utils/string.utils.js';
import {ApiGoalRef} from '../api-state.model.js';
import {Actor, bootedWithActorAndState, ToolInput} from './boot.js';
import {findWritableIssue} from './node-targets.js';

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

	return {
		...(goal ? {goal} : {}),
		...(ticket.props.color ? {color: ticket.props.color} : {}),
	};
};

type Ready = {actor: Actor; boot: {stateBranchRoot: string}};

type GoalEvent = AppEvent<'set.issue.goal'> | AppEvent<'set.issue.color'>;

const persist = (ready: Ready, issueId: string, event: GoalEvent) => {
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

export const setIssueColor = async (
	input: ToolInput & {issueId: string; color: string | null},
) => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const issueResult = findWritableIssue(input.issueId);
	if (isFail(issueResult)) return issueResult;
	const issue = issueResult.value;

	const color = input.color?.trim().toLowerCase() ?? null;
	if (color !== null && !HEX_COLOR.test(color)) {
		return failed('A colour is written #rrggbb');
	}

	if ((issue.props.color ?? null) === color) {
		return succeeded('No changes made', {id: issue.id, ref: nodeRef(issue.id)});
	}

	return persist(ready.value, issue.id, {
		id: ulid(),
		...actorOf(ready.value.actor),
		action: 'set.issue.color',
		payload: color === null ? {id: issue.id} : {id: issue.id, color},
	});
};
