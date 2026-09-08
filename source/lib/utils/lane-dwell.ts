import {clampUlidTime, getEventTime} from '../event/date-utils.js';
import {AppEvent} from '../event/event.model.js';

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
 * Every lane the ticket has been in, oldest first, read off its own log.
 *
 * The parent is compared rather than counted: dragging a card up its own column
 * writes a move carrying the lane it is already in, which is not a visit. One
 * walk answers all three questions a lane gets asked — when a ticket arrived,
 * where it came from, and where it went next.
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

/**
 * When the ticket last arrived in the lane it is in now. Falls back to
 * `createdAt` for a log that never names a parent.
 */
export const laneEntryTime = (
	log: readonly AppEvent[],
	createdAt: number,
): number => laneVisits(log, createdAt).at(-1)?.enteredAt ?? createdAt;
