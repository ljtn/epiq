// What a node's own events add up to, folded as each one applies, so the
// answers its log gave need no log. Times are kept raw: a clamp depends on when
// it is read.

import {clampUlidTime, getEventTime} from '../event/date-utils.js';
import {AppEvent} from './board-events.model.js';

export type NodeHistory = {
	// Each lane entered, oldest first; a null time reads as the node's creation.
	visits: Array<{laneId: string; at: number | null}>;
	// The latest time that was not ahead of the clock when folded, and those
	// that were: one of those may since have become honest.
	latestPast: number | null;
	ahead: number[];
	// The last close of any ticket logged here, by its id.
	lastCloseId: string | null;
	// Where a reopen returns the ticket: what its last close left behind.
	reopenParent: string | null;
	// Every parent the node's own events gave it, first seen first.
	parents: string[];
	// Fold state: the latest parent the node's own events named.
	lastParent: string | null;
};

export const emptyHistory = (): NodeHistory => ({
	visits: [],
	latestPast: null,
	ahead: [],
	lastCloseId: null,
	reopenParent: null,
	parents: [],
	lastParent: null,
});

// The events that can put a ticket somewhere else. Closing and reopening carry
// a parent for the same reason a move does, so both land here.
const laneOf = (event: AppEvent): string | null => {
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

// The parent an event gives the node it is about, whatever its action.
const ownParent = (event: AppEvent, nodeId: string): string | null => {
	const payload = event.payload as {id?: unknown; parent?: unknown};
	return payload.id === nodeId &&
		typeof payload.parent === 'string' &&
		payload.parent
		? payload.parent
		: null;
};

/** `history` with `events` after it, in order. Never writes into `history`. */
export const foldHistory = (
	history: NodeHistory | undefined,
	nodeId: string,
	events: readonly AppEvent[],
	now = Date.now(),
): NodeHistory => {
	const next = history ?? emptyHistory();
	const visits = [...next.visits];
	const ahead = [...next.ahead];
	const parents = [...next.parents];
	const known = new Set(parents);
	let {latestPast, lastCloseId, reopenParent, lastParent} = next;

	for (const event of events) {
		const time = getEventTime(event);

		const lane = laneOf(event);
		if (lane !== null && lane !== visits.at(-1)?.laneId) {
			visits.push({laneId: lane, at: time});
		}

		if (time !== null) {
			if (clampUlidTime(time, now) === time) {
				latestPast = latestPast === null ? time : Math.max(latestPast, time);
			} else ahead.push(time);
		}

		if (event.action === 'close.issue') {
			lastCloseId = event.id;
			if (event.payload.id === nodeId) reopenParent = lastParent;
		}

		const parent = ownParent(event, nodeId);
		if (parent !== null) {
			lastParent = parent;
			if (!known.has(parent)) {
				known.add(parent);
				parents.push(parent);
			}
		}
	}

	return {
		visits,
		latestPast,
		ahead,
		lastCloseId,
		reopenParent,
		parents,
		lastParent,
	};
};

export type LaneVisit = {laneId: string; enteredAt: number};

/** Every lane the node has been in, oldest first. */
export const visitsOf = (
	history: NodeHistory | undefined,
	createdAt: number,
): LaneVisit[] =>
	(history?.visits ?? []).map(({laneId, at}) => ({
		laneId,
		enteredAt: at === null ? createdAt : clampUlidTime(at),
	}));

/** When the node last arrived in the lane it is in now. */
export const enteredLaneAt = (
	history: NodeHistory | undefined,
	createdAt: number,
): number => {
	const last = history?.visits.at(-1);
	if (!last) return createdAt;
	return last.at === null ? createdAt : clampUlidTime(last.at);
};

/** When anything last happened to the node, by anyone. */
export const lastEventAt = (
	history: NodeHistory | undefined,
	createdAt: number,
): number => {
	let latest = createdAt;
	if (history?.latestPast != null) {
		latest = Math.max(latest, clampUlidTime(history.latestPast));
	}
	for (const time of history?.ahead ?? []) {
		latest = Math.max(latest, clampUlidTime(time));
	}
	return latest;
};

/** Every parent the node has had: the one it has now first. */
export const parentsEver = (
	history: NodeHistory | undefined,
	current: string | null | undefined,
): string[] => [
	...new Set([...(current ? [current] : []), ...(history?.parents ?? [])]),
];
