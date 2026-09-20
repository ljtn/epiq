import {ulidTimeMs} from '../../lib/event/date-utils.js';
import {Ticket} from '../../lib/model/context.model.js';
import {nodeRepo} from '../../lib/repository/node-repo.js';
import {identityOf, nameOf} from '../../lib/model/identity.js';
import {
	getTicketAssignees,
	getTicketTags,
} from '../../lib/utils/ticket.utils.js';
import {ApiIssue, ApiIssueComment} from '../api-state.model.js';

// Every board a lane has hung off, its current one included. A lane moves
// between boards too (`moveSwimlane`), and reading only where it hangs today
// would hand one board's history to another the moment somebody reorganises.
const boardsEverUnder = (laneId: string): string[] => {
	const lane = nodeRepo.getNode(laneId);
	if (!lane) return [];

	const boards = new Set<string>();

	if (lane.parentNodeId) boards.add(lane.parentNodeId);

	for (const entry of lane.log ?? []) {
		const payload = entry.payload as {id?: string; parent?: string};

		if (payload.id === laneId && payload.parent) boards.add(payload.parent);
	}

	return [...boards];
};

/**
 * Every board the ticket has lived on, its current one included.
 *
 * A board-scoped view of the past asks "was this ever this board's?" rather
 * than "is it now?": a board must not lose the work done on it because a ticket
 * was later closed, moved to another board, or had its whole column moved.
 *
 * Deliberately a flat set with no time in it, which is not the same rule
 * `boardsForEvents` applies to events — that one attributes each event to the
 * hierarchy as it stood at that moment. A commit carries no board and no
 * position in the log, only a ref, so the honest choices are "every board the
 * ticket has been on" or "the one it is on now". This errs towards keeping a
 * board's history: a ticket filed on one board and moved to another has its
 * later commits counted by both, rather than the first board losing the work
 * that was done while it held it.
 *
 * Read from the logs of the ticket and its lanes, so a deleted lane still names
 * the boards it hung off.
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
		for (const board of boardsEverUnder(laneId)) boards.add(board);
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
