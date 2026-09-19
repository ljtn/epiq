// One person's totals, counted off the event log.
//
// Pure over the events and an id, so it can be tested without a repository,
// a board or a single call to git. What it cannot answer is the commit
// figure — a commit is not an event this log knows about — which is why the
// caller in `mcp/api` hands that in rather than this reaching for it.

import {AppEvent} from '../board/board-events.model.js';
import {safeDateFromUlid} from '../event/date-utils.js';
import {isFail} from '../model/result-types.js';

export type AuthoredTotals = {
	tickets: number;
	comments: number;
	joinedAt: number | null;
};

/**
 * What the log says one contributor has done.
 *
 * Creations only. An `edit.title` is not a ticket and a `delete.issue.comment`
 * is not a comment un-written — the figures are a count of things this person
 * brought into being, which is the reading that does not change under somebody
 * else's later edit.
 *
 * A deleted ticket still counts. Tombstoning is how this log deletes, the
 * event stays, and the work was done; a total that fell when somebody else
 * tidied up would be a fact about them rather than about the person reading it.
 */
export const authoredTotals = (
	events: readonly AppEvent[],
	userId: string,
): AuthoredTotals => {
	let tickets = 0;
	let comments = 0;
	let joinedAt: number | null = null;

	for (const event of events) {
		if (event.userId !== userId) continue;

		if (event.action === 'add.issue') tickets++;
		if (event.action === 'add.issue.comment') comments++;

		// Their earliest event, whatever it was — including the one that created
		// them. Decoded defensively: an id this cannot read is one event's date
		// lost, not a panel that fails to draw.
		const at = safeDateFromUlid(event.id);
		if (isFail(at)) continue;

		const ms = at.value.getTime();
		if (joinedAt === null || ms < joinedAt) joinedAt = ms;
	}

	return {tickets, comments, joinedAt};
};
