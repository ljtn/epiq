import {ulid} from 'ulid';
import {describe, expect, it} from 'vitest';
import {
	mergePersistedEvents,
	parsePersistedEvents,
	serializePersistedEvents,
} from '../git/merge.js';
import {CompositeId, PersistedEvent} from '../lib/event/event-persist.js';
import {isFail} from '../lib/model/result-types.js';

// ---------------------------------------------------------------------------
// Helpers
//
// mergePersistedEvents only inspects each event's `id` (a [ulid, ref|null]
// tuple): the composite key is `${id}:${ref ?? ''}` and the sort time is
// decodeTime(id). The payload is opaque to the merge, so we stash an `origin`
// marker in it to detect which replica's version of a conflicting key survives.
//
// Note: these tests don't assert the application/load order of events. Merge
// only needs to produce a deterministic set (see the convergence test below);
// the order events are actually applied in is recomputed from event refs by
// getSortedEvents (event-load.ts) and covered separately in event-load.test.ts.
// ---------------------------------------------------------------------------

const compositeKey = ([id, ref]: CompositeId): string => `${id}:${ref ?? ''}`;

const makeEvent = (id: CompositeId, origin: string): PersistedEvent =>
	({
		v: 1,
		id,
		'init.workspace': {id: 'workspace-1', name: origin},
	} as PersistedEvent);

const originOf = (event: PersistedEvent): string =>
	(event as {'init.workspace': {name: string}})['init.workspace'].name;

// ---------------------------------------------------------------------------
// Minimal seeded fuzzing harness
//
// Replaces fast-check: a deterministic PRNG (mulberry32) drives small random
// generators, and `forAll` runs each property over many seeded cases. No
// shrinking, but the fixed seed keeps failures reproducible.
// ---------------------------------------------------------------------------

const RUNS = 200;

class Rng {
	private state: number;

	constructor(seed: number) {
		this.state = seed >>> 0;
	}

	// mulberry32
	next(): number {
		this.state = (this.state + 0x6d2b79f5) | 0;
		let t = this.state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	int(min: number, max: number): number {
		return min + Math.floor(this.next() * (max - min + 1));
	}

	bool(): boolean {
		return this.next() < 0.5;
	}

	pick<T>(items: readonly T[]): T {
		return items[this.int(0, items.length - 1)]!;
	}

	// option: null with ~25% probability, otherwise the generated value.
	option<T>(gen: () => T): T | null {
		return this.next() < 0.25 ? null : gen();
	}

	array<T>(maxLength: number, gen: () => T): T[] {
		const length = this.int(0, maxLength);
		return Array.from({length}, gen);
	}

	// Arbitrary string of printable-ish chars, including the empty string.
	string(maxLength = 12): string {
		const length = this.int(0, maxLength);
		let out = '';
		for (let i = 0; i < length; i++)
			out += String.fromCharCode(this.int(32, 126));
		return out;
	}
}

const forAll = (body: (rng: Rng) => void): void => {
	for (let seed = 1; seed <= RUNS; seed++) {
		body(new Rng(seed));
	}
};

const genTime = (rng: Rng): number => rng.int(0, 6); // small pool forces decodeTime collisions
const genRef = (rng: Rng): number | null => rng.option(() => genTime(rng));
const genPlacement = (rng: Rng): 'remote' | 'local' | 'both' =>
	rng.pick(['remote', 'local', 'both'] as const);

type Entry = {
	time: number;
	ref: number | null;
	placement: 'remote' | 'local' | 'both';
};

const genScenario = (rng: Rng): Entry[] =>
	rng.array(40, () => ({
		time: genTime(rng),
		ref: genRef(rng),
		placement: genPlacement(rng),
	}));

// Builds two replica logs from a scenario. Each entry gets a fresh ULID, so
// distinct entries never collide; the only intentional key collision is a
// 'both' entry, which appears in both logs with different origins.
const buildLogs = (
	scenario: Entry[],
): {remote: PersistedEvent[]; local: PersistedEvent[]} => {
	const remote: PersistedEvent[] = [];
	const local: PersistedEvent[] = [];

	for (const {time, ref, placement} of scenario) {
		const id: CompositeId = [ulid(time), ref === null ? null : ulid(ref)];

		if (placement === 'remote' || placement === 'both') {
			remote.push(makeEvent(id, 'remote'));
		}
		if (placement === 'local' || placement === 'both') {
			local.push(makeEvent(id, 'local'));
		}
	}

	return {remote, local};
};

describe('mergePersistedEvents (property)', () => {
	it('produces no duplicate composite keys', () => {
		forAll(rng => {
			const {remote, local} = buildLogs(genScenario(rng));
			const merged = mergePersistedEvents(remote, local);
			const keys = merged.map(e => compositeKey(e.id));

			expect(new Set(keys).size).toBe(keys.length);
		});
	});

	it('preserves exactly the union of distinct composite keys (no loss, no invention)', () => {
		forAll(rng => {
			const {remote, local} = buildLogs(genScenario(rng));
			const merged = mergePersistedEvents(remote, local);

			const inputKeys = new Set(
				[...remote, ...local].map(e => compositeKey(e.id)),
			);
			const outputKeys = new Set(merged.map(e => compositeKey(e.id)));

			expect(outputKeys).toEqual(inputKeys);
			expect(merged.length).toBe(inputKeys.size);
		});
	});

	it('resolves conflicting keys in favor of the local replica', () => {
		forAll(rng => {
			const {remote, local} = buildLogs(genScenario(rng));
			const merged = mergePersistedEvents(remote, local);
			const byKey = new Map(merged.map(e => [compositeKey(e.id), e]));

			// Any key present in both logs must keep the local replica's version.
			const remoteKeys = new Set(remote.map(e => compositeKey(e.id)));
			for (const event of local) {
				const key = compositeKey(event.id);
				if (remoteKeys.has(key)) {
					expect(originOf(byKey.get(key)!)).toBe('local');
				}
			}
		});
	});

	it('is idempotent: re-merging a merged log changes nothing', () => {
		forAll(rng => {
			const {remote, local} = buildLogs(genScenario(rng));
			const once = mergePersistedEvents(remote, local);
			const twice = mergePersistedEvents(once, []);
			const flipped = mergePersistedEvents([], once);

			expect(twice).toEqual(once);
			expect(flipped).toEqual(once);
			expect(mergePersistedEvents(once, once)).toEqual(once);
		});
	});

	it('converges regardless of how distinct events are partitioned across replicas', () => {
		// Distinct events (unique keys) split arbitrarily into two replicas must
		// merge to the same ordered log no matter the split or argument order.
		forAll(rng => {
			const events = rng
				.array(30, () => ({time: genTime(rng), ref: genRef(rng)}))
				.map(({time, ref}) =>
					makeEvent([ulid(time), ref === null ? null : ulid(ref)], 'x'),
				);
			const mask = events.map(() => rng.bool());

			const a: PersistedEvent[] = [];
			const b: PersistedEvent[] = [];
			events.forEach((e, i) => (mask[i] ? a : b).push(e));

			const ab = mergePersistedEvents(a, b).map(e => compositeKey(e.id));
			const ba = mergePersistedEvents(b, a).map(e => compositeKey(e.id));
			const whole = mergePersistedEvents(events, []).map(e =>
				compositeKey(e.id),
			);

			expect(ab).toEqual(whole);
			expect(ba).toEqual(whole);
		});
	});

	it('never throws on arbitrary (possibly non-ULID) id strings', () => {
		const genWildEvent = (rng: Rng): PersistedEvent =>
			({
				v: 1 as const,
				id: [rng.string(), rng.option(() => rng.string())],
				'init.workspace': {id: rng.string(), name: rng.string()},
			} as unknown as PersistedEvent);

		forAll(rng => {
			const remote = rng.array(20, () => genWildEvent(rng));
			const local = rng.array(20, () => genWildEvent(rng));

			expect(() => mergePersistedEvents(remote, local)).not.toThrow();
		});
	});
});

describe('serialize/parse round-trip (property)', () => {
	it('parse(serialize(events)) returns the original events', () => {
		forAll(rng => {
			const events = rng
				.array(30, () => ({time: genTime(rng), ref: genRef(rng)}))
				.map(({time, ref}, i) =>
					makeEvent([ulid(time), ref === null ? null : ulid(ref)], `o${i}`),
				);

			const result = parsePersistedEvents(serializePersistedEvents(events));
			expect(isFail(result)).toBe(false);
			if (!isFail(result)) {
				expect(result.value).toEqual(events);
			}
		});
	});

	it('parsing ignores blank and whitespace-only lines', () => {
		forAll(rng => {
			const blanks = rng.array(10, () => rng.pick(['', '   ', '\t'] as const));
			const event = makeEvent([ulid(1), null], 'x');
			const serialized =
				blanks.join('\n') + '\n' + JSON.stringify(event) + '\n';
			const result = parsePersistedEvents(serialized);

			expect(isFail(result)).toBe(false);
			if (!isFail(result)) {
				expect(result.value).toEqual([event]);
			}
		});
	});
});
