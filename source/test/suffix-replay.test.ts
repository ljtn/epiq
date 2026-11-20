import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import {bootStateFromEventLog} from '../lib/board/board-boot.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {materialize, materializeAll} from '../lib/board/board-log.js';
import {setSuffixReplay} from '../lib/board/board-replayed.js';
import {isFail} from '../lib/model/result-types.js';
import {nodes} from '../lib/state/node-builder.js';
import {initWorkspaceState, resetState} from '../lib/state/state.js';
import {setVirtualNodesEnabled} from '../lib/virtual-nodes/virtual-nodes.js';
import {derived, randomLog, rank, unwrap} from './helpers/random-board-log.js';

// A reload that applies only the new events must land on exactly the state a
// full replay of every event does, at every split, over hostile logs.

const bootMessage = (events: AppEvent[]): string => {
	const result = bootStateFromEventLog(events);
	if (isFail(result)) throw new Error(result.message);
	return result.message;
};

beforeAll(() => {
	setVirtualNodesEnabled(false);
	unwrap(initWorkspaceState(nodes.workspace('root', 'Root', rank())));
});

afterEach(() => {
	setSuffixReplay(false);
});

describe('a reload that only adds to the log', () => {
	it('lands where a full replay does, at every split, after an own write', () => {
		setSuffixReplay(true);
		let extended = 0;
		let splits = 0;

		for (let seed = 1; seed <= 25; seed++) {
			const events = randomLog(seed, 50);

			for (let split = 8; split < events.length - 1; split++) {
				splits++;

				unwrap(resetState());
				bootMessage(events.slice(0, split));
				// This process's own write, applied live as the GUI applies one.
				if (events[split]!.action !== 'init.workspace') {
					materialize(events[split]!);
				}
				if (bootMessage(events).startsWith('State extended')) extended++;
				const incremental = derived();

				unwrap(resetState());
				bootMessage(events);
				expect(incremental).toBe(derived());
			}
		}

		// Most splits take the suffix path, or this proved nothing.
		expect(extended).toBeGreaterThan(splits / 2);
	});

	// A newly synced duplicate of an id can sort ahead of the one applied: the
	// same id at the same place, carrying something else.
	it('replays in full when an applied event now reads differently', () => {
		setSuffixReplay(true);
		const events = randomLog(3, 40);
		const at = events.findIndex(
			(e, index) => index > 10 && e.action === 'add.issue',
		);
		const reread = events.map((e, index) =>
			index === at
				? ({
						...e,
						payload: {...(e.payload as object), name: 'Reread'},
				  } as AppEvent)
				: e,
		);

		unwrap(resetState());
		bootMessage(events.slice(0, 30));
		expect(bootMessage(reread)).toBe('State booted successfully');
		const incremental = derived();

		unwrap(resetState());
		bootMessage(reread);
		expect(incremental).toBe(derived());
	});

	// A forged root in a later sync must not wipe a board already applied.
	it('skips a second genesis in the suffix, as a full replay does', () => {
		setSuffixReplay(true);
		const log = randomLog(11, 30);
		const forged = {
			id: '01J9999000000000000000000F',
			action: 'init.workspace',
			payload: {id: '01J9999000000000000000000W', name: 'Forged', rank: rank()},
			userId: 'u1',
		} as AppEvent;
		const grown = [...log, forged];

		unwrap(resetState());
		bootMessage(log);
		expect(bootMessage(grown)).toMatch(/^State extended/);
		const incremental = derived();

		unwrap(resetState());
		bootMessage(grown);
		expect(incremental).toBe(derived());
	});

	// Ours was applied live after the boot; theirs sorts before it.
	it('replays in full when a foreign event sorts before an own write', () => {
		setSuffixReplay(true);
		const events = randomLog(12, 40);
		const own = events[30]!;
		const foreign = events[29]!;

		unwrap(resetState());
		bootMessage(events.slice(0, 29));
		materialize(own);
		const reordered = [
			...events.slice(0, 29),
			foreign,
			own,
			...events.slice(31),
		];
		expect(bootMessage(reordered)).toBe('State booted successfully');
		const incremental = derived();

		unwrap(resetState());
		bootMessage(reordered);
		expect(incremental).toBe(derived());
	});

	it('lands where a full replay does when the suffix fails', () => {
		setSuffixReplay(true);
		const events = randomLog(13, 30);
		const broken = {
			...events[5]!,
			id: '01J9999000000000000000000B',
			userId: '',
		} as AppEvent;
		const grown = [...events, broken];

		unwrap(resetState());
		bootMessage(events);
		const incremental = bootStateFromEventLog(grown);
		const afterIncremental = derived();

		unwrap(resetState());
		const full = bootStateFromEventLog(grown);

		expect(isFail(incremental) && incremental.message).toBe(
			isFail(full) && full.message,
		);
		expect(afterIncremental).toBe(derived());
	});

	// Rebuilt from the very same event objects, the log looks unchanged; only
	// the state's generation says it was replaced.
	it('replays in full after the state was rebuilt from the same events', () => {
		setSuffixReplay(true);
		const events = randomLog(14, 30);

		unwrap(resetState());
		bootMessage(events.slice(0, 20));
		unwrap(resetState());
		materializeAll(events.slice(0, 20));

		expect(bootMessage(events)).toBe('State booted successfully');
	});

	it('replays in full where it was not allowed, as the TUI does', () => {
		const events = randomLog(99, 40);

		unwrap(resetState());
		bootMessage(events.slice(0, 20));
		expect(bootMessage(events)).toBe('State booted successfully');
	});

	it('replays in full after a change the log does not hold', () => {
		setSuffixReplay(true);
		const events = randomLog(7, 40);

		unwrap(resetState());
		bootMessage(events.slice(0, 20));
		const preview = events.slice(0, 20).find(e => e.action === 'add.issue')!;
		materialize(
			{
				...preview,
				action: 'edit.title',
				payload: {id: preview.payload.id, name: 'Preview'},
			} as AppEvent,
			true,
		);

		expect(bootMessage(events)).toBe('State booted successfully');
	});
});
