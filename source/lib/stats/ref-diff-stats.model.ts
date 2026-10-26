// What each ticket's commits add up to. Types only, no imports: the GUI client
// reads it too.

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

/** Every ref's commits, sent once, so scrubbed totals are summed on the client. */
export type RefDiffTimeline = Record<string, RefCommitStat[]>;
