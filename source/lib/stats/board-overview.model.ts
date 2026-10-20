// Everything a board's panel is told about how the board runs.
//
// Types only, and no imports, like `swimlane-stats.model.ts`: the GUI client
// reads this file too, and nothing here is anything but JSON on a websocket.

// What a closed ticket spent in one lane, on average: the lanes' shares add
// up to the time a ticket spends on the board.
export type BoardLaneTime = {
	laneId: string;
	title: string;
	meanMs: number;
	share: number;
};

/** One week of closes, oldest first. */
export type BoardThroughputPoint = {
	// Start of the week, epoch ms.
	t: number;
	closed: number;
};

export type BoardOverview = {
	boardId: string;
	throughput: BoardThroughputPoint[];
	// Over the throughput's weeks: filed against closed says whether the
	// backlog grows.
	filed: number;
	closed: number;
	// Filed to closed, over the tickets closed in those weeks. Null when none
	// was.
	medianLeadTimeMs: number | null;
	// Of those, the share that went back to an earlier lane at least once.
	sentBackShare: number | null;
	// In board order, over the same closed tickets; lanes they never stood in
	// are left out.
	laneTime: BoardLaneTime[];
};
