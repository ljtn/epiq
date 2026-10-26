// What a ticket's own event log says: its age, how often it went backwards,
// and how long it has sat where it is. Pure, no imports.

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
 * `lanes` in board order. A move to an unlisted lane (e.g. Closed) counts as
 * neither forwards nor back.
 */
export const deriveBoardStats = ({
	createdAt,
	enteredLaneAt,
	now,
	history,
	lanes,
	currentLaneId,
}: {
	createdAt: number;
	// From `laneEntryTime`, which sees the whole log; the moves alone can't tell
	// an arrival from a reorder.
	enteredLaneAt: number;
	now: number;
	// Oldest first, as the ticket's log is kept.
	history: BoardMove[];
	lanes: BoardLane[];
	currentLaneId: string;
}): BoardStats => {
	const orderById = new Map(lanes.map((lane, index) => [lane.id, index]));

	let timesSentBack = 0;

	// Walked forwards from the board's first lane, where a ticket is filed.
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

		if (index !== undefined) previousIndex = index;
	}

	return {
		ageMs: Math.max(0, now - createdAt),
		timesSentBack,
		inLaneMs: Math.max(0, now - enteredLaneAt),
		laneTitle: lanes.find(lane => lane.id === currentLaneId)?.title ?? '',
	};
};
