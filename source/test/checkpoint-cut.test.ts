import {ulid} from 'ulid';
import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
	forgetCheckpoints,
	materializeCut,
} from '../lib/board/board-checkpoints.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {
	decodeReconstructedEvents,
	extendCutIndex,
	getSortedEvents,
	indexForCuts,
	materializeAll,
	splitEventsAtTime,
	type ReconstructedEvent,
} from '../lib/board/board-log.js';
import {succeeded} from '../lib/model/result-types.js';
import {nodes} from '../lib/state/node-builder.js';
import {initWorkspaceState, resetState} from '../lib/state/state.js';
import {setVirtualNodesEnabled} from '../lib/virtual-nodes/virtual-nodes.js';
import {derived, randomLog, rank, unwrap} from './helpers/random-board-log.js';
import {seededRandom} from './helpers/seeded-random.js';

// A cut from the nearest checkpoint must land exactly where a replay of every
// event the cut applies does, at every cut, over hostile concurrent logs.

const T0 = Date.UTC(2020, 0, 1);

// The events as a log holds them: an id that carries its time, and a parent
// that is mostly the last event, sometimes an older one (concurrent work), so
// a branch can run ahead of a concurrent one.
const entriesOf = (seed: number, events: AppEvent[]): ReconstructedEvent[] => {
	const random = seededRandom(seed * 7 + 1);
	const ids = new Map<string, string>();
	const written: string[] = [];

	const entries = events.map((event, index) => {
		// The same id again keeps its duplicate: one id, two payloads.
		let id = ids.get(event.id);
		if (!id) {
			const poisoned = random(40) === 0;
			id = ulid(poisoned ? Date.UTC(2099, 0, 1) : T0 + index * 60_000);
			ids.set(event.id, id);
		}

		const parent =
			index === 0
				? null
				: random(5) === 0
				? written[random(written.length)]!
				: written.at(-1)!;
		written.push(id);

		return {
			v: 1,
			id: parent ? [id, parent] : [id],
			[event.action]: event.payload,
			userId: event.userId,
			userName: 'one',
		} as unknown as ReconstructedEvent;
	});

	return getSortedEvents(entries);
};

// The cut as it was taken before checkpoints: reset, then replay every
// applied event in one batch.
const replayedCut = (entries: ReconstructedEvent[], targetTime: number) => {
	const {appliedEvents} = splitEventsAtTime(entries, targetTime);
	unwrap(resetState());
	materializeAll(unwrap(decodeReconstructedEvents(appliedEvents)));
	return derived();
};

beforeAll(() => {
	setVirtualNodesEnabled(false);
	unwrap(initWorkspaceState(nodes.workspace('root', 'Root', rank())));
});

afterEach(() => {
	forgetCheckpoints();
});

describe('a cut from the nearest checkpoint', () => {
	it('lands where a full replay of the cut does, in any order of cuts', () => {
		for (let seed = 1; seed <= 12; seed++) {
			const entries = entriesOf(seed, randomLog(seed, 70));
			const random = seededRandom(seed);
			const cuts = entries.map((_, index) => T0 + index * 60_000 + 1);
			cuts.push(T0 - 1, Date.UTC(2100, 0, 1));

			// Shuffled, so earlier checkpoints are restored after later ones were
			// taken: one written into by further replay would show here.
			for (let index = cuts.length - 1; index > 0; index--) {
				const swap = random(index + 1);
				[cuts[index], cuts[swap]] = [cuts[swap]!, cuts[index]!];
			}

			forgetCheckpoints();
			for (const cut of cuts) {
				unwrap(
					materializeCut(`log-${seed}`, () => succeeded('', entries), cut, {
						budget: 8,
						minGap: 4,
					}),
				);
				const fromCheckpoint = derived();

				expect(fromCheckpoint).toBe(replayedCut(entries, cut));
			}
		}
	});

	it('reads the log again once its key changes', () => {
		const first = entriesOf(1, randomLog(1, 30));
		const second = entriesOf(2, randomLog(2, 30));
		const end = Date.UTC(2100, 0, 1);

		unwrap(materializeCut('first', () => succeeded('', first), end));
		unwrap(materializeCut('second', () => succeeded('', second), end));

		expect(derived()).toBe(replayedCut(second, end));
	});
});

// Own writes: a chain off the tail, each id new.
const ownChain = (
	entries: ReconstructedEvent[],
	count: number,
	at: number,
): ReconstructedEvent[] => {
	const chain: ReconstructedEvent[] = [];
	let parent = entries.at(-1)!.id[0];
	for (let index = 0; index < count; index++) {
		const id = ulid(at + index);
		chain.push({
			v: 1,
			id: [id, parent],
			'edit.title': {id: 'nothing', name: `own ${index}`},
			userId: 'u1',
			userName: 'one',
		} as unknown as ReconstructedEvent);
		parent = id;
	}
	return chain;
};

describe('the cut index of a log that grew', () => {
	it('extends to what indexing it all again gives', () => {
		for (let seed = 1; seed <= 20; seed++) {
			const entries = entriesOf(seed, randomLog(seed, 50));
			const grown = [...entries, ...ownChain(entries, 3, T0 + 99 * 60_000)];

			expect(
				extendCutIndex(indexForCuts(entries), grown, entries.length),
			).toEqual(indexForCuts(grown));
		}
	});

	it('refuses what own writes do not add', () => {
		const entries = entriesOf(5, randomLog(5, 30));
		const index = indexForCuts(entries);
		const [own] = ownChain(entries, 1, T0 + 99 * 60_000);
		const offTail = {
			...own!,
			id: [own!.id[0], entries[0]!.id[0]],
		} as ReconstructedEvent;
		const again = {
			...own!,
			id: [entries[3]!.id[0], entries.at(-1)!.id[0]],
		} as ReconstructedEvent;

		expect(
			extendCutIndex(index, [...entries, offTail], entries.length),
		).toBeNull();
		expect(
			extendCutIndex(index, [...entries, again], entries.length),
		).toBeNull();
	});

	it('cuts as a full replay does after own writes, checkpoints kept', () => {
		for (let seed = 1; seed <= 6; seed++) {
			const entries = entriesOf(seed, randomLog(seed, 60));
			const grown = [...entries, ...ownChain(entries, 4, T0 + 99 * 60_000)];
			const end = Date.UTC(2100, 0, 1);

			forgetCheckpoints();
			unwrap(
				materializeCut('before', () => succeeded('', entries), end, {
					budget: 8,
					minGap: 4,
				}),
			);

			for (const cut of [
				end,
				T0 + 20 * 60_000 + 1,
				T0 + 99 * 60_000 + 2 * 60_000,
			]) {
				unwrap(
					materializeCut('after', () => succeeded('', grown), cut, {
						budget: 8,
						minGap: 4,
					}),
				);
				expect(derived()).toBe(replayedCut(grown, cut));
			}
		}
	});
});

describe("checkpoints after a teammate's event lands mid-order", () => {
	it('are dropped, so a cut lands as a full replay does', () => {
		for (let seed = 1; seed <= 8; seed++) {
			const entries = entriesOf(seed, randomLog(seed, 60));
			const lane = (
				entries.find(entry => 'add.swimlane' in entry) as unknown as {
					'add.swimlane': {id: string};
				}
			)['add.swimlane'].id;
			const teammate = {
				v: 1,
				id: [ulid(T0 + 15 * 60_000 + 1), entries[15]!.id[0]],
				'add.issue': {
					id: `teammate-${seed}`,
					name: 'Late',
					parent: lane,
					rank: rank(),
				},
				userId: 'u2',
				userName: 'two',
			} as unknown as ReconstructedEvent;
			const merged = getSortedEvents([...entries, teammate]);
			expect(merged.at(-1)).not.toBe(teammate);
			const end = Date.UTC(2100, 0, 1);

			forgetCheckpoints();
			unwrap(
				materializeCut('before', () => succeeded('', entries), end, {
					budget: 8,
					minGap: 4,
				}),
			);
			unwrap(
				materializeCut('after', () => succeeded('', merged), end, {
					budget: 8,
					minGap: 4,
				}),
			);
			expect(derived()).toBe(replayedCut(merged, end));
		}
	});
});

// Live is every entry, an undecodable time included, which a cut at any time,
// however late, leaves out.
describe('the live board from a checkpoint', () => {
	const fullReplay = (entries: ReconstructedEvent[]) => {
		unwrap(resetState());
		materializeAll(unwrap(decodeReconstructedEvents(entries)));
		return derived();
	};

	it('lands where replaying every entry does, undecodable times included', () => {
		for (let seed = 1; seed <= 8; seed++) {
			const base = entriesOf(seed, randomLog(seed, 50));
			// Tickets filed under ids that carry no time.
			const lane = (
				base.find(entry => 'add.swimlane' in entry) as unknown as {
					'add.swimlane': {id: string};
				}
			)['add.swimlane'].id;
			const timeless = [0, 1, 2].map(
				index =>
					({
						v: 1,
						id: [
							`not-a-time-${seed}-${index}`.padEnd(26, 'x'),
							base.at(-1)!.id[0],
						],
						'add.issue': {
							id: `timeless-${seed}-${index}`,
							name: 'No time',
							parent: lane,
							rank: rank(),
						},
						userId: 'u1',
						userName: 'one',
					} as unknown as ReconstructedEvent),
			);
			const entries = getSortedEvents([...base, ...timeless]);

			forgetCheckpoints();
			for (const cut of [
				T0 + 30 * 60_000,
				Date.UTC(2100, 0, 1),
				null,
				T0 + 10 * 60_000,
				null,
			]) {
				unwrap(
					materializeCut(`live-${seed}`, () => succeeded('', entries), cut, {
						budget: 8,
						minGap: 4,
					}),
				);
				if (cut === null) expect(derived()).toBe(fullReplay(entries));
			}
		}
	});
});
