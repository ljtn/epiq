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
	// Where a ticket's events sit in the app-wide event log, in order: its
	// history, without a copy of it. Valid only while that log is appended to,
	// or replaced together with the nodes.
	logged: number[];
};

// Shared by every node that has none: most never gain an ahead time, and many
// no visits or parents.
const NONE: never[] = Object.freeze([]) as unknown as never[];

export const emptyHistory = (): NodeHistory => ({
	visits: NONE,
	latestPast: null,
	ahead: NONE,
	lastCloseId: null,
	reopenParent: null,
	parents: NONE,
	lastParent: null,
	logged: NONE,
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
	// Each event's place in the app-wide log, for a node whose history is shown.
	positions: readonly number[] | null = null,
	now = Date.now(),
): NodeHistory => {
	const next = history ?? emptyHistory();
	// Copied on first change only: a list no event adds to stays the one held.
	let {visits, ahead, parents} = next;
	let ownVisits = false;
	let ownAhead = false;
	let ownParents = false;
	let {latestPast, lastCloseId, reopenParent, lastParent} = next;

	for (const event of events) {
		const time = getEventTime(event);

		const lane = laneOf(event);
		if (lane !== null && lane !== visits.at(-1)?.laneId) {
			if (!ownVisits) [visits, ownVisits] = [[...visits], true];
			visits.push({laneId: lane, at: time});
		}

		if (time !== null) {
			if (clampUlidTime(time, now) === time) {
				latestPast = latestPast === null ? time : Math.max(latestPast, time);
			} else {
				if (!ownAhead) [ahead, ownAhead] = [[...ahead], true];
				ahead.push(time);
			}
		}

		if (event.action === 'close.issue') {
			lastCloseId = event.id;
			if (event.payload.id === nodeId) reopenParent = lastParent;
		}

		const parent = ownParent(event, nodeId);
		if (parent !== null) {
			lastParent = parent;
			// A handful per node: a scan beats keeping a set beside them.
			if (!parents.includes(parent)) {
				if (!ownParents) [parents, ownParents] = [[...parents], true];
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
		logged:
			positions && positions.length > 0
				? [...next.logged, ...positions]
				: next.logged,
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

/** A ticket's own events, oldest first, from the app-wide log it sits in. */
export const loggedEvents = (
	history: NodeHistory | undefined,
	eventLog: readonly AppEvent[],
): AppEvent[] => (history?.logged ?? []).map(position => eventLog[position]!);
