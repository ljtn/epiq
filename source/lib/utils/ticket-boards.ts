// Which boards a ticket has stood on, read from its own log and its lanes'.

import {Ticket} from '../model/context.model.js';
import {nodeRepo} from '../repository/node-repo.js';

// A lane's log holds its tickets' events too, so it is read once per lane, not
// once per ticket. Keyed by the node, which every update replaces.
const boardsUnderLane = new WeakMap<object, string[]>();

// Every board a lane has hung off, since lanes move between boards too.
const boardsEverUnder = (laneId: string): string[] => {
	const lane = nodeRepo.getNode(laneId);
	if (!lane) return [];

	const cached = boardsUnderLane.get(lane);
	if (cached) return cached;

	const boards = new Set<string>();

	if (lane.parentNodeId) boards.add(lane.parentNodeId);

	for (const entry of lane.log ?? []) {
		const payload = entry.payload as {id?: string; parent?: string};

		if (payload.id === laneId && payload.parent) boards.add(payload.parent);
	}

	const result = [...boards];
	boardsUnderLane.set(lane, result);

	return result;
};

// Keyed by the node, which every update replaces, so a closed ticket's log is
// walked once rather than on every write to the board.
const lanesOfTicket = new WeakMap<object, string[]>();

const lanesEverIn = (ticket: Ticket): string[] => {
	const cached = lanesOfTicket.get(ticket);
	if (cached) return cached;

	const lanes = new Set<string>();

	if (ticket.parentNodeId) lanes.add(ticket.parentNodeId);

	for (const entry of ticket.log ?? []) {
		const payload = entry.payload as {id?: string; parent?: string};

		if (payload.id === ticket.id && payload.parent) lanes.add(payload.parent);
	}

	const result = [...lanes];
	lanesOfTicket.set(ticket, result);

	return result;
};

/**
 * Every board the ticket has lived on, so a board keeps work done on it after
 * a move or close. Read from ticket and lane logs, deleted lanes included.
 */
export const boardsEverOnOf = (ticket: Ticket): string[] => {
	const boards = new Set<string>();

	for (const laneId of lanesEverIn(ticket)) {
		for (const board of boardsEverUnder(laneId)) boards.add(board);
	}

	return [...boards];
};
