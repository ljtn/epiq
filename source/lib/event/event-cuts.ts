// Where a cut at a time falls in a causal order: which events it applies.
// Time decides only the cut; order is still the parent links'.

import {decodeTime, toEffectiveUlidTimes} from './date-utils.js';
import type {ReconstructedEvent} from './event-parse.js';

// The time a checkout cut judges each event by: raw where honest, inherited
// where poisoned. Computed once, so every consumer agrees.
export const effectiveEventTimes = (
	events: ReadonlyArray<Pick<ReconstructedEvent, 'id'>>,
): Array<number | null> =>
	toEffectiveUlidTimes(
		events.map(event => {
			try {
				return decodeTime(event.id[0]);
			} catch {
				return null;
			}
		}),
	);

/** A causal order's ids as numbers and each event's parent as one, for cuts. */
export type CutIndex = {
	times: ReadonlyArray<number | null>;
	idOf: Int32Array;
	parentOf: Int32Array;
	ids: number;
};

// A parent the order does not hold, which never excludes its child.
const NO_PARENT = -1;

export const indexForCuts = (
	events: ReadonlyArray<Pick<ReconstructedEvent, 'id'>>,
): CutIndex => {
	const numbers = new Map<string, number>();
	const idOf = new Int32Array(events.length);
	for (let index = 0; index < events.length; index++) {
		const id = events[index]!.id[0];
		let number = numbers.get(id);
		if (number === undefined) {
			number = numbers.size;
			numbers.set(id, number);
		}
		idOf[index] = number;
	}

	const parentOf = new Int32Array(events.length);
	for (let index = 0; index < events.length; index++) {
		const refId = events[index]!.id[1];
		parentOf[index] = refId ? numbers.get(refId) ?? NO_PARENT : NO_PARENT;
	}

	return {
		times: effectiveEventTimes(events),
		idOf,
		parentOf,
		ids: numbers.size,
	};
};

/**
 * The index for `events`, which are `index`'s events plus a chain appended to
 * their tail, each new: what own writes add. Null for anything else, which
 * needs `indexForCuts`.
 */
export const extendCutIndex = (
	index: CutIndex,
	events: ReadonlyArray<Pick<ReconstructedEvent, 'id'>>,
	from: number,
): CutIndex | null => {
	const idOf = new Int32Array(events.length);
	const parentOf = new Int32Array(events.length);
	idOf.set(index.idOf.subarray(0, from));
	parentOf.set(index.parentOf.subarray(0, from));
	let ids = index.ids;

	for (let position = from; position < events.length; position++) {
		const [id, refId] = events[position]!.id;
		if (position === 0 || refId !== events[position - 1]!.id[0]) return null;

		for (let earlier = 0; earlier < position; earlier++) {
			const [otherId, otherRef] = events[earlier]!.id;
			if (otherId === id || otherRef === id) return null;
		}

		idOf[position] = ids++;
		parentOf[position] = idOf[position - 1]!;
	}

	return {times: effectiveEventTimes(events), idOf, parentOf, ids};
};

/**
 * Which events a cut at `targetTime` applies, by index into the causal order:
 * those before it whose parent it also applies.
 */
export const appliedAtTime = (
	events: ReadonlyArray<Pick<ReconstructedEvent, 'id'>>,
	targetTime: number,
	index: CutIndex = indexForCuts(events),
): Uint8Array => {
	const {times, idOf, parentOf} = index;
	const excluded = new Uint8Array(index.ids);
	const applied = new Uint8Array(events.length);

	for (let position = 0; position < events.length; position++) {
		const time = times[position] ?? null;
		const parent = parentOf[position]!;

		if (
			time === null ||
			time >= targetTime ||
			(parent !== NO_PARENT && excluded[parent])
		) {
			excluded[idOf[position]!] = 1;
		} else {
			applied[position] = 1;
		}
	}

	return applied;
};

export const splitEventsAtTime = (
	events: ReconstructedEvent[],
	targetTime: number,
): {
	appliedEvents: ReconstructedEvent[];
	unappliedEvents: ReconstructedEvent[];
} => {
	const applied = appliedAtTime(events, targetTime);

	return {
		appliedEvents: events.filter((_, index) => applied[index]),
		unappliedEvents: events.filter((_, index) => !applied[index]),
	};
};

/** Reads the log for one catalog: its actions, payload checks and genesis. */
