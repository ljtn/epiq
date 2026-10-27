import {ulidTimeMs} from '../../lib/event/date-utils.js';
import {Ticket} from '../../lib/model/context.model.js';
import {nodeRepo} from '../../lib/repository/node-repo.js';
import {identityOf, nameOf} from '../../lib/model/identity.js';
import {
	getTicketAssignees,
	getTicketTags,
} from '../../lib/utils/ticket.utils.js';
import {ApiIssue, ApiIssueComment, ApiIssueDetail} from '../api-state.model.js';

// The lib helpers answer which tags and assignees a ticket has; these add the
// colour the API surface carries and nothing else.
export const getIssueTags = (ticket: Ticket) =>
	getTicketTags(ticket).map(tag => identityOf(tag.id, tag.name));

// A comment's id is its ULID, so sorting the ids is log order.
export const getIssueComments = (issueId: string): ApiIssueComment[] =>
	nodeRepo
		.getCommentsByIssue(issueId)
		.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
		.map(comment => ({
			id: comment.id,
			author: nameOf(
				comment.authorId,
				nodeRepo.getContributor(comment.authorId)?.name,
			),
			createdAt: ulidTimeMs(comment.id),
			body: comment.md,
		}));

export const getIssueAssignees = (ticket: Ticket) =>
	getTicketAssignees(ticket).map(
		({id, name}) =>
			identityOf(id, name) satisfies ApiIssue['assignees'][number],
	);

const RECENT_COMMENTS = 3;
const GIST_LENGTH = 200;

const gistOf = (body: string) => {
	const line = body.split('\n', 1)[0] ?? '';
	return line.length > GIST_LENGTH || line.length < body.length
		? `${line.slice(0, GIST_LENGTH)}…`
		: line;
};

// The latest comments whole, every earlier one by its first line: a decision
// is almost always that line, and the whole thread stays one call away.
export const getIssueThread = (
	issueId: string,
	all = false,
): Pick<ApiIssueDetail, 'comments' | 'olderComments'> => {
	const comments = getIssueComments(issueId);
	const older = comments.length - RECENT_COMMENTS;
	if (all || older <= 0) return {comments};

	return {
		comments: comments.map((comment, index) =>
			index < older ? {...comment, body: gistOf(comment.body)} : comment,
		),
		olderComments: `The first ${older} show their first line only: pass allComments to read them whole`,
	};
};
