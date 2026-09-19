/**
 * What one person's work in a repository adds up to.
 *
 * Deliberately not per board. A project's boards share one event log and one
 * git history, and somebody's tickets do not stop being theirs when the board
 * switcher moves — a figure that changed under the switcher would read as
 * their work disappearing. The panel these are drawn in says "your work here",
 * and "here" is the repository.
 *
 * Types only, so the GUI client can read them without pulling the event log
 * in behind them.
 */
export type PersonalStats = {
	/**
	 * Whether the repository's history could be read at all.
	 *
	 * False and the two commit figures below mean nothing — they are not zero,
	 * they are unknown. Told apart because the panel says something quite
	 * different in each case: "no address of yours has commits" is a nudge to
	 * claim one, and saying it to somebody who holds several because a git
	 * call failed is simply wrong.
	 */
	scanned: boolean;
	/** Commits by every git address this person claims. */
	commits: number;
	/** Tickets they opened. */
	tickets: number;
	/** Comments they wrote. */
	comments: number;
	/**
	 * When they first did anything here, epoch ms, or null for somebody who
	 * has not yet. Their earliest event rather than the contributor record:
	 * a contributor can be created by somebody else assigning them.
	 */
	joinedAt: number | null;
	/** How many git addresses the commit figure was counted over. */
	claimedEmails: number;
};
