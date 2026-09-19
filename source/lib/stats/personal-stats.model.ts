/**
 * What one person's work on a board adds up to.
 *
 * Types only, so the GUI client can read them without pulling the event log
 * in behind them.
 */
export type PersonalStats = {
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
