import {ulidTimeMs} from '../../lib/event/date-utils.js';
import {Ticket} from '../../lib/model/context.model.js';
import {nodeRepo} from '../../lib/repository/node-repo.js';
import {identityOf, nameOf} from '../../lib/model/identity.js';
import {
	getTicketAssignees,
	getTicketTags,
} from '../../lib/utils/ticket.utils.js';
import {ApiIssue, ApiIssueComment} from '../api-state.model.js';

/**
 * Every board the ticket has lived on, its current one included.
 *
 * A board-scoped view of the past asks "was this ever this board's?" rather
 * than "is it now?". An event belongs to the board the ticket was on when it
 * happened — `boardsForEvents` attributes them that way — and the commits
 * linked to a ticket belong there for the same reason. Closing is one of these
 * moves, reparenting to the global Closed lane; so is a move to another
 * board's lane, which `moveIssue` allows.
 *
 * Read from the ticket's own log, which is where the lanes it has had are
 * recorded. A deleted lane still names the board it hung off, so a board does
 * not lose its own history when somebody tidies a column away.
 */
export const boardsEverOnOf = (ticket: Ticket): string[] => {
	const lanes = new Set<string>();

	if (ticket.parentNodeId) lanes.add(ticket.parentNodeId);

	for (const entry of ticket.log ?? []) {
		const payload = entry.payload as {id?: string; parent?: string};

		if (payload.id === ticket.id && payload.parent) lanes.add(payload.parent);
	}

	const boards = new Set<string>();

	for (const laneId of lanes) {
		const board = nodeRepo.getNode(laneId)?.parentNodeId;
		if (board) boards.add(board);
	}

	return [...boards];
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
