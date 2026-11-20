// The causal order of a set of events, and when new events may simply be
// appended to an order already held rather than sorted again.

import {ENVELOPE_KEYS, type ReconstructedEvent} from './event-parse.js';

// Code units, not `localeCompare`, which follows the process locale.
const byCodeUnit = (a: string, b: string): number =>
	a < b ? -1 : a > b ? 1 : 0;

/**
 * Total, so order depends only on the event set: equal ids fall through to the
 * actor and payload, which every replica has identically.
 */
export const compareEvents = (
	a: ReconstructedEvent,
	b: ReconstructedEvent,
): number => {
	const byId = byCodeUnit(a.id[0], b.id[0]);
	if (byId !== 0) return byId;

	return byCodeUnit(JSON.stringify(a), JSON.stringify(b));
};

/**
 * The causal order: a forest by `refId`, siblings by id, walked depth-first.
 * `genesis` names the only action allowed to be a root.
 */
export const sortEvents = (
	reconstructedEvents: ReconstructedEvent[],
	genesis: string,
): ReconstructedEvent[] =>
	sortEventsIndexed(reconstructedEvents, genesis).sorted;

export type OrderIndex = {
	// Whether an id is held; "maybe" must answer yes.
	ids: {has(id: string): boolean};
	waiting: Set<string>;
	spine: ReconstructedEvent[] | null;
};

/**
 * Where `added` lands when it all lands after the order `index` describes: in
 * the order a full sort gives it, and the spine after it. Null otherwise, and
 * only a full sort is exact.
 */
export const appendToOrder = (
	index: OrderIndex,
	added: ReadonlyArray<ReconstructedEvent>,
): {order: ReconstructedEvent[]; spine: ReconstructedEvent[]} | null => {
	const {ids, waiting, spine} = index;
	if (!spine) return null;

	// Searched from the end: a new event's parent is nearly always the tail.
	const depthOf = (id: string): number => {
		for (let depth = spine.length - 1; depth >= 0; depth--) {
			if (spine[depth]!.id[0] === id) return depth;
		}
		return -1;
	};

	const newIds = new Set<string>();
	for (const entry of added) {
		const id = entry.id[0];
		// New, and nothing held waits on it: else it would sort in among them.
		if (ids.has(id) || waiting.has(id) || newIds.has(id)) return null;
		newIds.add(id);
	}

	const childrenOf = new Map<string, ReconstructedEvent[]>();
	const spineParents = new Map<string, number>();
	for (const entry of added) {
		const parent = entry.id[1];
		if (!parent) return null;

		if (!newIds.has(parent)) {
			// Under a held event: only on the spine, and after the child the
			// tail hangs from, or it sorts in among what is held.
			const depth = depthOf(parent);
			if (depth < 0) return null;
			const next = spine[depth + 1];
			if (next && compareEvents(entry, next) <= 0) return null;
			spineParents.set(parent, depth);
		}

		const siblings = childrenOf.get(parent) ?? [];
		siblings.push(entry);
		childrenOf.set(parent, siblings);
	}
	for (const siblings of childrenOf.values()) siblings.sort(compareEvents);

	// Deepest first: a full sort reaches a spine node's later children only
	// after everything below its path.
	const order: ReconstructedEvent[] = [];
	const parentIn = new Map<string, ReconstructedEvent>();
	const deepestFirst = [...spineParents].sort((a, b) => b[1] - a[1]);
	for (const [parent] of deepestFirst) {
		const stack = [...childrenOf.get(parent)!].reverse();
		while (stack.length > 0) {
			const entry = stack.pop()!;
			order.push(entry);
			for (const child of [...(childrenOf.get(entry.id[0]) ?? [])].reverse()) {
				parentIn.set(child.id[0], entry);
				stack.push(child);
			}
		}
	}

	// A new event under one that never landed hangs off nothing held.
	if (order.length !== added.length) return null;
	if (order.length === 0) return {order, spine};

	// The new tail's path, back up to where it joins the old spine.
	const path: ReconstructedEvent[] = [];
	let at: ReconstructedEvent | undefined = order.at(-1);
	while (at && newIds.has(at.id[0])) {
		path.push(at);
		at = parentIn.get(at.id[0]);
	}
	const joinedAt = spineParents.get(path.at(-1)!.id[1]!)!;
	const next = [...spine.slice(0, joinedAt + 1), ...path.reverse()];

	return {
		order,
		spine: next.length > SPINE_LIMIT ? next.slice(-SPINE_LIMIT) : next,
	};
};

// How many of the tail's ancestors are kept: an event appended under a deeper
// one is declined, and the order is sorted again.
const SPINE_LIMIT = 4096;

// The tail's nearest ancestors, nearest last: an event appended under one of
// them sorts last. None where the tail closed a cycle, which only a sort orders.
const spineOf = (
	events: ReconstructedEvent[],
	parentOf: Int32Array,
	placedAt: Int32Array,
	tail: number,
	tailPhase: number,
): ReconstructedEvent[] | null => {
	if (tail < 0 || tailPhase > 2) return null;

	const path: ReconstructedEvent[] = [];
	let at = tail;
	while (path.length < SPINE_LIMIT) {
		path.push(events[at]!);
		const parent = parentOf[at]!;
		if (parent < 0) break;
		at = placedAt[parent]!;
	}

	return path.reverse();
};

/**
 * The causal order, with the ids it holds and the parents it names but does
 * not hold: what an append to it has to check, built on the way.
 */
export const sortEventsIndexed = (
	reconstructedEvents: ReconstructedEvent[],
	genesis: string,
): {
	sorted: ReconstructedEvent[];
	ids: Map<string, number>;
	waiting: Set<string>;
	spine: ReconstructedEvent[] | null;
} => {
	const events = reconstructedEvents;
	const count = events.length;

	// Ids as numbers, one per distinct id: a duplicate shares its number.
	const idNumbers = new Map<string, number>();
	const idOf = new Int32Array(count);
	for (let index = 0; index < count; index++) {
		const eventId = events[index]!.id[0];
		let number = idNumbers.get(eventId);
		if (number === undefined) {
			number = idNumbers.size;
			idNumbers.set(eventId, number);
		}
		idOf[index] = number;
	}

	const NO_PARENT = -1;
	const UNKNOWN_PARENT = -2;
	const parentOf = new Int32Array(count);
	const childCounts = new Int32Array(idNumbers.size + 1);
	const waiting = new Set<string>();
	for (let index = 0; index < count; index++) {
		const refId = events[index]!.id[1] ?? null;
		const parent =
			refId === null ? NO_PARENT : idNumbers.get(refId) ?? UNKNOWN_PARENT;
		parentOf[index] = parent;
		if (parent >= 0) childCounts[parent + 1]!++;
		else if (parent === UNKNOWN_PARENT) waiting.add(refId!);
	}

	// Each id's children are childIndex[childStart[id] .. childStart[id + 1]].
	const childStart = childCounts;
	for (let id = 1; id < childStart.length; id++) {
		childStart[id]! += childStart[id - 1]!;
	}
	const childIndex = new Int32Array(childStart[idNumbers.size]!);
	const filled = childStart.slice(0, idNumbers.size);
	for (let index = 0; index < count; index++) {
		const parent = parentOf[index]!;
		if (parent >= 0) childIndex[filled[parent]!++] = index;
	}

	const byEvent = (a: number, b: number) =>
		compareEvents(events[a]!, events[b]!);
	for (let id = 0; id < idNumbers.size; id++) {
		const from = childStart[id]!;
		const to = childStart[id + 1]!;
		if (to - from > 1) childIndex.subarray(from, to).sort(byEvent);
	}

	const result: ReconstructedEvent[] = [];
	const placed = new Uint8Array(idNumbers.size);
	// Where each id was placed, and the phase the tail was placed in.
	const placedAt = new Int32Array(idNumbers.size);
	let tail = -1;
	let phase = 0;
	// Each event is pushed once by its parent, plus the root.
	const stack = new Int32Array(count + 1);

	// An explicit stack: the forest is one chain as long as the log.
	const visit = (root: number) => {
		let top = 0;
		stack[top++] = root;

		while (top > 0) {
			const index = stack[--top]!;
			const id = idOf[index]!;

			if (placed[id]) continue;

			result.push(events[index]!);
			placed[id] = 1;
			placedAt[id] = index;
			tail = index;

			// Reversed, so the lowest-ULID sibling is popped first.
			for (
				let child = childStart[id + 1]! - 1;
				child >= childStart[id]!;
				child--
			) {
				stack[top++] = childIndex[child]!;
			}
		}
	};

	const sortedIndexes = (keep: (index: number) => boolean): number[] => {
		const kept: number[] = [];
		for (let index = 0; index < count; index++)
			if (keep(index)) kept.push(index);
		return kept.sort(byEvent);
	};

	// Only genesis may be a root: a forged `refId: null` would sort before history.
	// Exactly one action key, or extra keys smuggle a payload past the check.
	const roots = sortedIndexes(index => {
		if (parentOf[index] !== NO_PARENT) return false;
		const keys = Object.keys(events[index]!).filter(
			key => !ENVELOPE_KEYS.has(key),
		);
		return keys.length === 1 && keys[0] === genesis;
	});
	phase = 1;
	for (const root of roots) visit(root);

	const orphanRoots = sortedIndexes(
		index => !placed[idOf[index]!] && parentOf[index]! < 0,
	);
	phase = 2;
	for (const orphanRoot of orphanRoots) visit(orphanRoot);

	const remaining = sortedIndexes(index => !placed[idOf[index]!]);
	const tailPhase = phase;
	phase = 3;
	for (const index of remaining) visit(index);

	return {
		sorted: result,
		ids: idNumbers,
		waiting,
		spine: spineOf(
			events,
			parentOf,
			placedAt,
			remaining.length > 0 ? -1 : tail,
			tailPhase,
		),
	};
};

// The time a checkout cut judges each event by: raw where honest, inherited
// where poisoned. Computed once, so every consumer agrees.
