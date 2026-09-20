import {ulidTimeMs} from '../../lib/event/date-utils.js';
import {Ticket} from '../../lib/model/context.model.js';
import {nodeRepo} from '../../lib/repository/node-repo.js';
import {identityOf, nameOf} from '../../lib/model/identity.js';
import {
	getTicketAssignees,
	getTicketTags,
} from '../../lib/utils/ticket.utils.js';
import {ApiIssue, ApiIssueComment} from '../api-state.model.js';
import {CLOSED_SWIMLANE_ID} from '../../lib/board/static-ids.js';
import {resolveReopenParentFromLog} from '../../lib/board/log-utils.js';

// The board a closed ticket left. Closing hangs it off the global Closed lane,
// so its own board is no longer readable from where it sits — but the lane it
// came from is still in its log, the same one a reopen would put it back in.
// Null for an open ticket.
//
// A deleted lane still answers: it names the board it hung off, and deleting it
// leaves the tickets closed out of it where they are. Reading it as no board at
// all would take every one of them out of that board's own views.
export const closedFromBoardIdOf = (ticket: Ticket): string | null => {
	if (ticket.parentNodeId !== CLOSED_SWIMLANE_ID) return null;

	const laneId = resolveReopenParentFromLog(ticket);

	return (laneId && nodeRepo.getNode(laneId)?.parentNodeId) ?? null;
};

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
