// The rules a node's log was read by before the log went: the reference its
// folded history is checked against.

import {AppEvent} from '../../lib/board/board-events.model.js';
import {LaneVisit} from '../../lib/board/node-history.js';
import {clampUlidTime, getEventTime} from '../../lib/event/date-utils.js';

// The events that can put a ticket somewhere else. Closing and reopening carry
// a parent for the same reason a move does, so both land here.
const parentOf = (event: AppEvent): string | null => {
	switch (event.action) {
		case 'add.issue':
		case 'move.node':
		case 'close.issue':
		case 'reopen.issue':
			return event.payload.parent;
		default:
			return null;
	}
};

/**
 * Every lane the ticket has been in, oldest first, from its log. A move to
 * its current lane is not a visit.
 */
export const laneVisits = (
	log: readonly AppEvent[],
	createdAt: number,
): LaneVisit[] => {
	const visits: LaneVisit[] = [];

	for (const event of log) {
		const laneId = parentOf(event);
		if (laneId === null || laneId === visits.at(-1)?.laneId) continue;

		const time = getEventTime(event);

		visits.push({
			laneId,
			enteredAt: time === null ? createdAt : clampUlidTime(time),
		});
	}

	return visits;
};

/** When anything last happened to the ticket, by anyone: its log's latest event. */
export const lastEventTime = (
	log: readonly AppEvent[],
	createdAt: number,
): number =>
	log.reduce((latest, event) => {
		const time = getEventTime(event);
		return time === null ? latest : Math.max(latest, clampUlidTime(time));
	}, createdAt);

/**
 * When the ticket last arrived in the lane it is in now. Falls back to
 * `createdAt` for a log that never names a parent.
 */
export const laneEntryTime = (
	log: readonly AppEvent[],
	createdAt: number,
): number => {
	// Back from the end, over the last run of moves into one lane: the last
	// of `laneVisits` without walking the whole log.
	let lane: string | null = null;
	let enteredAt = createdAt;

	for (let index = log.length - 1; index >= 0; index--) {
		const event = log[index]!;
		const laneId = parentOf(event);
		if (laneId === null) continue;
		if (lane !== null && laneId !== lane) break;

		lane = laneId;
		const time = getEventTime(event);
		enteredAt = time === null ? createdAt : clampUlidTime(time);
	}

	return enteredAt;
};

export const reopenParentFromLog = (
	nodeId: string,
	log: readonly AppEvent[],
): string | null => {
	for (let i = log.length - 1; i >= 0; i--) {
		const entry = log[i];
		if (!entry) continue;

		if (entry.action !== 'close.issue') continue;
		if (entry.payload.id !== nodeId) continue;

		for (let j = i - 1; j >= 0; j--) {
			const previousEntry = log[j];

			if (
				previousEntry &&
				'id' in previousEntry.payload &&
				previousEntry.payload.id === nodeId &&
				'parent' in previousEntry.payload &&
				previousEntry.payload.parent
			) {
				return previousEntry.payload.parent;
			}
		}

		return null;
	}

	return null;
};
