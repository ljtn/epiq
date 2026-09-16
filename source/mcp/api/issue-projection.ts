import {ulidTimeMs} from '../../lib/event/date-utils.js';
import {Ticket} from '../../lib/model/context.model.js';
import {nodeRepo} from '../../lib/repository/node-repo.js';
import {getStringColor} from '../../lib/utils/color.js';
import {
	getTicketAssignees,
	getTicketTags,
} from '../../lib/utils/ticket.utils.js';
import {ApiIssue, ApiIssueComment} from '../api-state.model.js';

// The lib helpers answer which tags and assignees a ticket has; these add the
// colour the API surface carries and nothing else.
export const getIssueTags = (ticket: Ticket) =>
	getTicketTags(ticket).map(tag => ({
		id: tag.id,
		name: tag.name,
		color: getStringColor(tag.name),
	}));

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
	getTicketAssignees(ticket).map(
		({id, name}) =>
			({
				id,
				name,
				color: getStringColor(name),
			} satisfies ApiIssue['assignees'][number]),
	);
