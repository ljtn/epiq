import {describe, expect, it} from 'vitest';
import {seededRandom} from './helpers/seeded-random.js';
import {
	appendToOrder,
	sortEvents,
	sortEventsIndexed,
} from '../lib/event/event-load.js';
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
	const random = seededRandom(seed);
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

// A board's log as writers make it: a genesis root, chains, and now and then a
// branch off an older event.
const chainLog = (seed: number, size: number): ReconstructedEvent[] => {
	const random = seededRandom(seed);
	const ids = ['E0000'];
	const log = [
		{id: ['E0000', null], userId: 'u0', userName: 'one', [GENESIS]: {}},
	] as unknown as ReconstructedEvent[];
	for (let index = 1; index < size; index++) {
		const id = `E${String(index).padStart(4, '0')}`;
		const parent = random(10) < 7 ? ids.at(-1)! : ids[random(ids.length)]!;
		ids.push(id);
		log.push({
			id: [id, parent],
			userId: `u${random(3)}`,
			userName: 'someone',
			edit: {n: index},
		} as unknown as ReconstructedEvent);
	}
	return log;
};

describe('appendToOrder', () => {
	it('places additions where a full sort does, or declines', () => {
		let accepted = 0;
		let tried = 0;

		for (let seed = 1; seed <= 600; seed++) {
			const log =
				seed % 3 === 0
					? randomLog(seed, 5 + (seed % 60))
					: chainLog(seed, 5 + (seed % 60));
			const held = sortEventsIndexed([...log], GENESIS);
			const random = seededRandom(seed * 31 + 7);
			const heldIds = held.sorted.map(entry => entry.id[0]);
			const spineIds = (held.spine ?? []).map(entry => entry.id[0]);
			const added: ReconstructedEvent[] = [];

			for (let k = 0; k < 1 + random(4); k++) {
				const roll = random(20);
				const id =
					roll === 0
						? heldIds[random(heldIds.length)]!
						: roll === 1
						? `X${random(5)}`
						: roll === 2 && added.length > 0
						? added[0]!.id[0]
						: `${random(8) === 0 ? 'A' : 'N'}${seed}-${k}`;
				const pick = random(20);
				const parent =
					pick < 8
						? held.sorted.at(-1)?.id[0] ?? null
						: pick < 12 && spineIds.length > 0
						? spineIds[random(spineIds.length)]!
						: pick < 15
						? heldIds[random(heldIds.length)]!
						: pick < 18 && added.length > 0
						? added[random(added.length)]!.id[0]
						: pick === 18
						? null
						: `Y${random(3)}`;
				added.push({
					id: [id, parent],
					userId: 'u9',
					userName: 'them',
					edit: {n: k},
				} as unknown as ReconstructedEvent);
			}

			tried++;
			const result = appendToOrder(held, added);
			if (!result) continue;
			accepted++;

			const fresh = sortEventsIndexed([...log, ...added], GENESIS);
			expect([...held.sorted, ...result.order]).toEqual(fresh.sorted);
			expect(result.spine).toEqual(fresh.spine);
		}

		// Declining everything would pass the check above and prove nothing.
		expect(accepted).toBeGreaterThan(tried / 5);
	});
});

describe('appendToOrder, at the phase boundaries', () => {
	const entry = (id: string, parent: string | null, action = 'edit') =>
		({
			id: [id, parent],
			userId: 'u0',
			userName: 'one',
			[action]: {},
		} as unknown as ReconstructedEvent);

	// The genesis tree, then an orphan's tree, which holds the tail.
	const log = [
		entry('A0', null, GENESIS),
		entry('A1', 'A0'),
		entry('A2', 'A1'),
		entry('B0', 'MISSING'),
		entry('B1', 'B0'),
	];

	const expectExact = (added: ReconstructedEvent[]) => {
		const held = sortEventsIndexed([...log], GENESIS);
		const result = appendToOrder(held, added);
		expect(result).not.toBeNull();
		const fresh = sortEventsIndexed([...log, ...added], GENESIS);
		expect([...held.sorted, ...result!.order]).toEqual(fresh.sorted);
	};

	it('appends under an orphan tree that holds the tail', () => {
		expectExact([entry('C0', 'B1')]);
	});

	it('declines under the genesis tree when an orphan tree holds the tail', () => {
		const held = sortEventsIndexed([...log], GENESIS);
		expect(appendToOrder(held, [entry('C0', 'A2')])).toBeNull();
		// The full sort would place it before the orphan tree.
		const fresh = sortEventsIndexed([...log, entry('C0', 'A2')], GENESIS);
		expect(fresh.sorted.at(-1)!.id[0]).not.toBe('C0');
	});

	it('declines the parent an orphan waits on, which re-homes it', () => {
		const held = sortEventsIndexed([...log], GENESIS);
		expect(appendToOrder(held, [entry('MISSING', 'B1')])).toBeNull();
		expect(appendToOrder(held, [entry('MISSING', 'A2')])).toBeNull();
	});
});
