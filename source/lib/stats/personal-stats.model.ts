/**
 * One person's work in a repository, across all its boards. Types only, for
 * the GUI client.
 */
export type PersonalStats = {
	/**
	 * Whether the history could be read; when false the commit figures below are
	 * unknown, not zero.
	 */
	scanned: boolean;
	/** Commits by every git address this person claims. */
	commits: number;
	/** Tickets they opened. */
	tickets: number;
	/** Comments they wrote. */
	comments: number;
	/**
	 * Their earliest event, epoch ms, or null; not the contributor record, which
	 * someone else can create by assigning them.
	 */
	joinedAt: number | null;
	/** How many git addresses the commit figure was counted over. */
	claimedEmails: number;
};
