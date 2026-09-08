// Everything a swimlane's stats panel is told, in one place.
//
// Types only, and no imports, for the same reason `issue-stats.model.ts` has
// none: the GUI client reads this file the way the Node side does, and nothing
// here is anything but JSON on a websocket.

/**
 * One end of a lane's traffic — where its tickets were before, or where they
 * went after. `laneId` is null for the two cases that are not another lane:
 * a ticket filed straight into this one, and one closed out of it.
 */
export type LaneFlow = {
	laneId: string | null;
	title: string;
	count: number;
	// Of every counted arrival or departure, so a lane with two sources reads
	// as the split it is rather than as a winner.
	share: number;
};

export type SwimlaneCode = {
	// Of the tickets in the lane now, how many own any commits at all. The
	// counts below are theirs, and say nothing about tickets that have moved on.
	tickets: number;
	commits: number;
	insertions: number;
	deletions: number;
};

/** One day's reading of the lane's median stay. */
export type LaneStayPoint = {
	t: number;
	// Null on a day the lane stood empty — not zero, which would read as
	// tickets being served instantly.
	median: number | null;
	count: number;
};

export type SwimlaneStats = {
	swimlaneId: string;
	// Decoded from the swimlane's own ULID.
	createdAt: number;
	// Tickets that have been in this lane and left it. The flows below are
	// counted over these, since a ticket sitting in the lane now has an
	// arrival but no departure yet.
	departed: number;
	arrived: number;
	arrivesFrom: LaneFlow[];
	movesOnTo: LaneFlow[];
	code: SwimlaneCode;
	// Oldest first, one point per day, ending today.
	stayTrend: LaneStayPoint[];
};
