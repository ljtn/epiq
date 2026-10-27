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
const COMMENT_CUT = 2000;

// A thread reads latest first: the last few, a long body cut, and a hint
// naming what is left out, so the rest stays one call away.
export const getIssueThread = (
	issueId: string,
	all = false,
): Pick<ApiIssueDetail, 'comments' | 'olderComments'> => {
	const comments = getIssueComments(issueId);
	if (all) return {comments};

	const recent = comments.slice(-RECENT_COMMENTS).map(comment =>
		comment.body.length > COMMENT_CUT
			? {
					...comment,
					body: `${comment.body.slice(
						0,
						COMMENT_CUT,
					)}… [cut: allComments reads it whole]`,
			  }
			: comment,
	);
	const older = comments.length - recent.length;

	return older
		? {
				comments: recent,
				olderComments: `${older} earlier comment${
					older === 1 ? '' : 's'
				}: pass allComments to read the whole thread`,
		  }
		: {comments: recent};
};
