// One person's totals from the event log. Pure; the commit figure is handed in
// by the caller.

import {AppEvent} from '../board/board-events.model.js';
import {safeDateFromUlid} from '../event/date-utils.js';
import {isFail} from '../model/result-types.js';

export type AuthoredTotals = {
	tickets: number;
	comments: number;
	joinedAt: number | null;
};

/**
 * What one contributor has created, per the log. Later edits and deletes by
 * others don't lower it.
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

		// Their earliest event; an unreadable id loses one date, not the panel.
		const at = safeDateFromUlid(event.id);
		if (isFail(at)) continue;

		const ms = at.value.getTime();
		if (joinedAt === null || ms < joinedAt) joinedAt = ms;
	}

	return {tickets, comments, joinedAt};
};
