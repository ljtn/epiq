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

/**
 * When the ticket last arrived in the lane it is in now, read off its own log.
 * The parent is compared rather than counted: dragging a card up its own column
 * writes a move carrying the lane it is already in, and must not restart the
 * clock. Falls back to `createdAt` for a log that never names a parent.
 */
export const laneEntryTime = (
	log: readonly AppEvent[],
	createdAt: number,
): number => {
	let parent: string | null = null;
	let entered = createdAt;

	for (const event of log) {
		const next = parentOf(event);
		if (next === null || next === parent) continue;

		const time = getEventTime(event);
		parent = next;
		if (time !== null) entered = clampUlidTime(time);
	}

	return entered;
};
