import {ulid} from 'ulid';
import fc from 'fast-check';
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

// A small time pool forces decodeTime collisions, so deduplication and
// convergence are exercised even when distinct events share a timestamp.
const timeArb = fc.integer({min: 0, max: 6});
const refArb = fc.option(timeArb, {nil: null});
const placementArb = fc.constantFrom('remote', 'local', 'both') as fc.Arbitrary<
	'remote' | 'local' | 'both'
>;

type Entry = {
	time: number;
	ref: number | null;
	placement: 'remote' | 'local' | 'both';
};

const scenarioArb = fc.array(
	fc.record({time: timeArb, ref: refArb, placement: placementArb}),
	{maxLength: 40},
);

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
		fc.assert(
			fc.property(scenarioArb, scenario => {
				const {remote, local} = buildLogs(scenario);
				const merged = mergePersistedEvents(remote, local);
				const keys = merged.map(e => compositeKey(e.id));

				expect(new Set(keys).size).toBe(keys.length);
			}),
		);
	});

	it('preserves exactly the union of distinct composite keys (no loss, no invention)', () => {
		fc.assert(
			fc.property(scenarioArb, scenario => {
				const {remote, local} = buildLogs(scenario);
				const merged = mergePersistedEvents(remote, local);

				const inputKeys = new Set(
					[...remote, ...local].map(e => compositeKey(e.id)),
				);
				const outputKeys = new Set(merged.map(e => compositeKey(e.id)));

				expect(outputKeys).toEqual(inputKeys);
				expect(merged.length).toBe(inputKeys.size);
			}),
		);
	});

	it('resolves conflicting keys in favor of the local replica', () => {
		fc.assert(
			fc.property(scenarioArb, scenario => {
				const {remote, local} = buildLogs(scenario);
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
			}),
		);
	});

	it('is idempotent: re-merging a merged log changes nothing', () => {
		fc.assert(
			fc.property(scenarioArb, scenario => {
				const {remote, local} = buildLogs(scenario);
				const once = mergePersistedEvents(remote, local);
				const twice = mergePersistedEvents(once, []);
				const flipped = mergePersistedEvents([], once);

				expect(twice).toEqual(once);
				expect(flipped).toEqual(once);
				expect(mergePersistedEvents(once, once)).toEqual(once);
			}),
		);
	});

	it('converges regardless of how distinct events are partitioned across replicas', () => {
		// Distinct events (unique keys) split arbitrarily into two replicas must
		// merge to the same ordered log no matter the split or argument order.
		const distinctArb = fc
			.array(fc.record({time: timeArb, ref: refArb}), {maxLength: 30})
			.map(specs =>
				specs.map(({time, ref}) =>
					makeEvent([ulid(time), ref === null ? null : ulid(ref)], 'x'),
				),
			);

		fc.assert(
			fc.property(
				distinctArb,
				fc.array(fc.boolean(), {maxLength: 30}),
				(events, mask) => {
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
				},
			),
		);
	});

	it('never throws on arbitrary (possibly non-ULID) id strings', () => {
		const wildEventArb = fc.record({
			v: fc.constant(1 as const),
			id: fc.tuple(fc.string(), fc.option(fc.string(), {nil: null})),
			'init.workspace': fc.record({id: fc.string(), name: fc.string()}),
		}) as unknown as fc.Arbitrary<PersistedEvent>;

		fc.assert(
			fc.property(
				fc.array(wildEventArb, {maxLength: 20}),
				fc.array(wildEventArb, {maxLength: 20}),
				(remote, local) => {
					expect(() => mergePersistedEvents(remote, local)).not.toThrow();
				},
			),
		);
	});
});

describe('serialize/parse round-trip (property)', () => {
	it('parse(serialize(events)) returns the original events', () => {
		const eventsArb = fc
			.array(fc.record({time: timeArb, ref: refArb}), {maxLength: 30})
			.map(specs =>
				specs.map(({time, ref}, i) =>
					makeEvent([ulid(time), ref === null ? null : ulid(ref)], `o${i}`),
				),
			);

		fc.assert(
			fc.property(eventsArb, events => {
				const result = parsePersistedEvents(serializePersistedEvents(events));
				expect(isFail(result)).toBe(false);
				if (!isFail(result)) {
					expect(result.value).toEqual(events);
				}
			}),
		);
	});

	it('parsing ignores blank and whitespace-only lines', () => {
		fc.assert(
			fc.property(
				fc.array(fc.constantFrom('', '   ', '\t'), {maxLength: 10}),
				blanks => {
					const event = makeEvent([ulid(1), null], 'x');
					const serialized =
						blanks.join('\n') + '\n' + JSON.stringify(event) + '\n';
					const result = parsePersistedEvents(serialized);

					expect(isFail(result)).toBe(false);
					if (!isFail(result)) {
						expect(result.value).toEqual([event]);
					}
				},
			),
		);
	});
});
