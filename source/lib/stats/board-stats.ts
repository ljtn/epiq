// What the board says about a ticket, as against what its code says.
//
// Three facts, all of them from the ticket's own event log: how long it has
// existed, how often it has gone backwards through the lanes, and how long it
// has sat where it is now. None of them is a verdict either — a ticket can be
// old because it is hard, or because nobody looked at it, and the difference is
// exactly what the third number is for.
//
// Types only in, numbers out, no imports: the caller hands over the history it
// already has, so this costs no read of its own and the GUI, the TUI and the
// MCP can each derive the same answer from their own copy.

export type BoardMove = {
	// Epoch ms.
	t: number;
	action: string;
	// The lane the move put the ticket in. Absent on every event that is not a
	// move, and on a move whose destination the log did not record.
	parentId?: string;
};

export type BoardLane = {
	id: string;
	title: string;
};

export type BoardStats = {
	ageMs: number;
	// Moves to a lane earlier in the board's order than the one the ticket was
	// in. Rework, in the only form a board can see it.
	timesSentBack: number;
	// Since the move that put it where it is, or since it was filed if it has
	// never moved.
	inLaneMs: number;
	laneTitle: string;
};

const MOVE = 'move.node';

/**
 * `lanes` in board order, which is what makes "backwards" mean anything. A
 * move to a lane the board does not list — the Closed board's own lane, most
 * often — is counted as neither forwards nor back: it left the board rather
 * than moving within it.
 */
export const deriveBoardStats = ({
	createdAt,
	now,
	history,
	lanes,
	currentLaneId,
}: {
	createdAt: number;
	now: number;
	// Oldest first, as the ticket's log is kept.
	history: BoardMove[];
	lanes: BoardLane[];
	currentLaneId: string;
}): BoardStats => {
	const orderById = new Map(lanes.map((lane, index) => [lane.id, index]));

	let timesSentBack = 0;
	let landedInCurrentAt: number | null = null;

	// Walked forwards, carrying where the ticket was. A ticket is filed into
	// the board's first lane, so that is where the first move is measured
	// from; the log records where each move went, never where it came from.
	let previousIndex: number | null = 0;

	for (const event of history) {
		if (event.action !== MOVE || !event.parentId) continue;

		const index = orderById.get(event.parentId);

		if (
			index !== undefined &&
			previousIndex !== null &&
			index < previousIndex
		) {
			timesSentBack++;
		}

		if (event.parentId === currentLaneId) landedInCurrentAt = event.t;
		if (index !== undefined) previousIndex = index;
	}

	return {
		ageMs: Math.max(0, now - createdAt),
		timesSentBack,
		inLaneMs: Math.max(0, now - (landedInCurrentAt ?? createdAt)),
		laneTitle: lanes.find(lane => lane.id === currentLaneId)?.title ?? '',
	};
};
