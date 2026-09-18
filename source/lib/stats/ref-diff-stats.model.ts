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
