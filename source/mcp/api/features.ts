// A feature is a ticket standing for a bigger thing other tickets belong to:
// it has its own description, comments and status, and its title names it.
// A ticket belongs to one feature at most, one level deep, so the mark it
// carries is never ambiguous; tags stay the way to say several things.

import {ulid} from 'ulid';
import {actorOf, AppEvent} from '../../lib/board/board-events.model.js';
import {materializeAndPersistAll} from '../../lib/board/board-log.js';
import {Ticket} from '../../lib/model/context.model.js';
import {failed, isFail, succeeded} from '../../lib/model/result-types.js';
import {HEX_COLOR} from '../../lib/utils/color.js';
import {
	featureColor,
	featureRefusal,
	findTicket,
	getTicketFeature,
} from '../../lib/utils/feature.utils.js';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {sanitizeInlineText} from '../../lib/utils/string.utils.js';
import {ApiFeatureRef} from '../api-state.model.js';
import {Actor, bootedWithActorAndState, ToolInput} from './boot.js';
import {findWritableIssue} from './node-targets.js';

/** The feature a ticket belongs to, as it reads now, or none. */
export const getIssueFeature = (ticket: Ticket): ApiFeatureRef | undefined => {
	const feature = getTicketFeature(ticket);
	if (!feature) return undefined;

	return {
		id: feature.id,
		ref: nodeRef(feature.id),
		title: sanitizeInlineText(feature.title),
		color: featureColor(feature),
	};
};

/** What a ticket carries about features, for every projection of it. */
export const featureFields = (ticket: Ticket) => {
	const feature = getIssueFeature(ticket);

	return {
		...(feature ? {feature} : {}),
		...(ticket.props.color ? {color: ticket.props.color} : {}),
	};
};

type Ready = {actor: Actor; boot: {stateBranchRoot: string}};

type FeatureEvent = AppEvent<'set.issue.feature'> | AppEvent<'set.issue.color'>;

const persist = (ready: Ready, issueId: string, event: FeatureEvent) => {
	const results = materializeAndPersistAll([event], ready.boot.stateBranchRoot);
	if (isFail(results)) return failed(results.message);

	return succeeded('Saved', {id: issueId, ref: nodeRef(issueId)});
};

export const setIssueFeature = async (
	input: ToolInput & {issueId: string; feature: string | null},
) => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const issueResult = findWritableIssue(input.issueId);
	if (isFail(issueResult)) return issueResult;
	const issue = issueResult.value;

	if (input.feature === null) {
		if (!issue.props.feature) {
			return succeeded('No changes made', {
				id: issue.id,
				ref: nodeRef(issue.id),
			});
		}

		return persist(ready.value, issue.id, {
			id: ulid(),
			...actorOf(ready.value.actor),
			action: 'set.issue.feature',
			payload: {id: issue.id},
		});
	}

	const feature = findTicket(input.feature);
	if (!feature) return failed('Feature ticket not found');

	const refusal = featureRefusal(issue, feature);
	if (refusal) return failed(refusal);

	if (issue.props.feature === feature.id) {
		return succeeded('No changes made', {id: issue.id, ref: nodeRef(issue.id)});
	}

	return persist(ready.value, issue.id, {
		id: ulid(),
		...actorOf(ready.value.actor),
		action: 'set.issue.feature',
		payload: {id: issue.id, feature: feature.id},
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
