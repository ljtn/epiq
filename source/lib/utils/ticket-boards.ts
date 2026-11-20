// Which boards a ticket has stood on, from its own history and its lanes'.

import {parentsEver} from '../board/node-history.js';
import {Ticket} from '../model/context.model.js';
import {nodeRepo} from '../repository/node-repo.js';

// Every board a lane has hung off, since lanes move between boards too.
const boardsEverUnder = (laneId: string): string[] => {
	const lane = nodeRepo.getNode(laneId);
	return lane ? parentsEver(lane.history, lane.parentNodeId) : [];
};

/**
 * Every board the ticket has lived on: a flat set with no time, unlike `boardsForEvents`,
 * as a commit has only a ref, so a moved ticket's commits count on both boards.
 * Deleted lanes included.
 */
export const boardsEverOnOf = (ticket: Ticket): string[] => {
	const boards = new Set<string>();

	for (const laneId of parentsEver(ticket.history, ticket.parentNodeId)) {
		for (const board of boardsEverUnder(laneId)) boards.add(board);
	}

	return [...boards];
};
