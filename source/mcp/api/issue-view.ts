import {ulidTimeMs} from '../../lib/event/date-utils.js';
import {Ticket} from '../../lib/model/context.model.js';
import {isFail} from '../../lib/model/result-types.js';
import {nodeRepo} from '../../lib/repository/node-repo.js';
import {getSafeState} from '../../lib/state/state.js';
import {Contributor} from '../../lib/model/app-state.model.js';
import {getStringColor} from '../../lib/utils/color.js';
import {ApiIssue, ApiIssueComment} from '../api-state.model.js';

export const getIssueTags = (ticket: Ticket) =>
	(ticket.props.tags ?? [])
		.map(tag => nodeRepo.getTag(tag))
		.filter(tag => tag != undefined)
		.map(tag => ({
			id: tag.id,
			name: tag.name,
			color: getStringColor(tag.name),
		}));

// A contributor node's name is written once at create.contributor and never
// updated; the event log carries the current one.
export const getLatestNamesFromLog = (): Map<string, string> => {
	const stateResult = getSafeState();
	const eventLog = isFail(stateResult) ? [] : stateResult.value.eventLog ?? [];
	const byId = new Map<string, string>();

	for (const event of eventLog) {
		if (event.userId && event.userName) byId.set(event.userId, event.userName);
	}

	return byId;
};

// Shared so that every surface offering or matching a contributor agrees on the
// answer; disagreement mints duplicate ids for the same person.
export const mergeRegistryNames = (
	logNames: Map<string, string>,
	registry: Record<string, Contributor>,
): Map<string, string> => {
	const byId = new Map(logNames);

	// The registry always wins. The log's copy survives only for an id the
	// registry has never seen — an author on a board written before renames
	// were events.
	for (const contributor of Object.values(registry)) {
		byId.set(contributor.id, contributor.name);
	}

	return byId;
};

// A comment's id is its ULID, so sorting the ids is log order.
export const getIssueComments = (issueId: string): ApiIssueComment[] =>
	nodeRepo
		.getCommentsByIssue(issueId)
		.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
		.map(comment => ({
			id: comment.id,
			author:
				nodeRepo.getContributor(comment.authorId)?.name ??
				comment.authorName ??
				'Unknown',
			createdAt: ulidTimeMs(comment.id),
			body: comment.md,
		}));

export const getIssueAssignees = (ticket: Ticket) =>
	(ticket.props.assignees ?? [])
		.map(assignee => nodeRepo.getContributor(assignee))
		.filter(contributor => contributor != undefined)
		.map(
			({id, name}) =>
				({
					id,
					name,
					color: getStringColor(name),
				} satisfies ApiIssue['assignees'][number]),
		);
