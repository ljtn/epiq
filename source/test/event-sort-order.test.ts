import {describe, expect, it} from 'vitest';
import {sortEvents} from '../lib/event/event-load.js';
import type {ReconstructedEvent} from '../lib/event/event-load.js';

const GENESIS = 'init';
const ENVELOPE_KEYS = new Set(['id', 'v', 'userId', 'userName']);

// The plain causal sort, kept as the reference the indexed one must match.
const referenceSort = (events: ReconstructedEvent[]): ReconstructedEvent[] => {
	const compare = (a: ReconstructedEvent, b: ReconstructedEvent) => {
		const byCode = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
		return (
			byCode(a.id[0], b.id[0]) || byCode(JSON.stringify(a), JSON.stringify(b))
		);
	};
	const known = new Set(events.map(event => event.id[0]));
	const children = new Map<string | null, ReconstructedEvent[]>();
	for (const event of events) {
		const ref = event.id[1] ?? null;
		children.set(ref, [...(children.get(ref) ?? []), event]);
	}
	for (const list of children.values()) list.sort(compare);

	const result: ReconstructedEvent[] = [];
	const placed = new Set<string>();
	const visit = (root: ReconstructedEvent) => {
		const stack = [root];
		while (stack.length > 0) {
			const event = stack.pop()!;
			if (placed.has(event.id[0])) continue;
			result.push(event);
			placed.add(event.id[0]);
			stack.push(...[...(children.get(event.id[0]) ?? [])].reverse());
		}
	};

	(children.get(null) ?? [])
		.filter(event => {
			const keys = Object.keys(event).filter(key => !ENVELOPE_KEYS.has(key));
			return keys.length === 1 && keys[0] === GENESIS;
		})
		.forEach(visit);
	events
		.filter(
			event =>
				!placed.has(event.id[0]) &&
				(event.id[1] == null || !known.has(event.id[1])),
		)
		.sort(compare)
		.forEach(visit);
	events
		.filter(event => !placed.has(event.id[0]))
		.sort(compare)
		.forEach(visit);

	return result;
};

// Small ids so siblings, duplicates, cycles and dangling parents are common.
const randomLog = (seed: number, size: number): ReconstructedEvent[] => {
	let state = seed;
	const random = (n: number) => {
		state = (state * 1103515245 + 12345) % 2147483648;
		return state % n;
	};
	const id = () => `E${String(random(size)).padStart(4, '0')}`;

	return Array.from({length: size}, (_, index) => {
		const pick = random(10);
		const ref = pick === 0 ? null : pick === 1 ? `X${random(5)}` : id();
		const action = pick === 0 && random(2) === 0 ? GENESIS : 'edit';
		return {
			id: [index === 0 ? 'E0000' : id(), ref],
			userId: `u${random(3)}`,
			userName: 'someone',
			[action]: {n: random(3)},
			...(random(20) === 0 ? {smuggled: true} : {}),
		} as unknown as ReconstructedEvent;
	});
};

describe('sortEvents', () => {
	it('matches the reference order on hostile logs', () => {
		for (let seed = 1; seed <= 300; seed++) {
			const log = randomLog(seed, 5 + (seed % 120));
			expect(sortEvents([...log], GENESIS)).toEqual(referenceSort(log));
		}
	});
});
