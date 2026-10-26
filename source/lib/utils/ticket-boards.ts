// Which boards a ticket has stood on, read from its own log and its lanes'.

import {Ticket} from '../model/context.model.js';
import {nodeRepo} from '../repository/node-repo.js';

// A lane's log holds its tickets' events too, so it is read once per lane, not
// once per ticket. Keyed by the node, which every update replaces.
const boardsUnderLane = new WeakMap<object, string[]>();

// Every board a lane has hung off, its current one included. A lane moves
// between boards too (`moveSwimlane`), and reading only where it hangs today
// would hand one board's history to another the moment somebody reorganises.
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
	const boards = new Set<string>();

	for (const laneId of lanesEverIn(ticket)) {
		for (const board of boardsEverUnder(laneId)) boards.add(board);
	}

	return [...boards];
};
