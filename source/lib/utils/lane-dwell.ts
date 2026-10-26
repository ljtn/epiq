import {clampUlidTime, getEventTime} from '../event/date-utils.js';
import {AppEvent} from '../board/board-events.model.js';

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

export type LaneVisit = {laneId: string; enteredAt: number};

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
): number => laneVisits(log, createdAt).at(-1)?.enteredAt ?? createdAt;
