// What one ticket's commits add up to, for every ticket at once.
//
// Types only, and no imports, for the same reason `swimlane-stats.model.ts`
// has none: the GUI client reads this file the way the Node side does, and
// nothing here is anything but JSON on a websocket.

export type RefDiffStat = {
	commits: number;
	insertions: number;
	deletions: number;
};

/** Keyed by ref, upper-case, and holding only refs some commit names. */
export type RefDiffStats = Record<string, RefDiffStat>;

/** One commit's share of a ticket: when it was made, and the lines it moved. */
export type RefCommitStat = {
	time: number;
	insertions: number;
	deletions: number;
};

/**
 * Every ref's commits, sent once, so a scrubbed board's totals at any moment
 * are a sum on the client rather than a question per step of the needle.
 */
export type RefDiffTimeline = Record<string, RefCommitStat[]>;
