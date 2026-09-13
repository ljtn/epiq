import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {
	clearEdgeCache,
	getEdgeRef,
	loadEffectiveEventTimes,
	loadEventActors,
	loadMergedEventsBefore,
	loadMergedEventsWithUnreadable,
} from '../lib/event/event-load.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {generateLog} from './stress/generate-log.js';

// The loader's public surface under both cores over one generated log: what
// a boot, a checkout, a contributor guard, a peek and a write each read.
describe('event-load under the Rust core and the TypeScript core', () => {
	let stateRoot: string;
	let eventsDir: string;

	beforeAll(async () => {
		stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-core-wired-'));
		eventsDir = path.join(stateRoot, '.epiq', 'events');

		await generateLog({
			stateRoot,
			laneIds: ['lane-1', 'lane-2', 'lane-3'],
			actors: Array.from({length: 6}, (_, i) => ({
				userId: `01ARZ3NDEKTSV4RRFFQ69G5FA${i}`,
				userName: `person${i}`,
			})),
			events: 20_000,
			years: 3,
			tagNames: ['gui', 'bug', 'sync'],
		});

		// A few lines no generator writes: a corrupt one, a foreign action, a
		// newer version, so the quarantine list has something to agree on.
		fs.appendFileSync(
			path.join(eventsDir, '01ARZ3NDEKTSV4RRFFQ69G5FAV.hostile.jsonl'),
			[
				'{"v":1,"id":["01H0000000000000000000000B",null],"lock.node"',
				JSON.stringify({
					v: 1,
					id: ['01H0000000000000000000000C', null],
					'redact.contributor': {id: 'c'},
				}),
				JSON.stringify({
					v: 2,
					id: ['01H0000000000000000000000D', '01H0000000000000000000000C'],
					'edit.title': {id: 'x', name: 'y'},
				}),
			].join('\n') + '\n',
		);
	});

	afterAll(() => {
		fs.rmSync(stateRoot, {recursive: true, force: true});
	});

	// `useRustCore` reads the variable at every call, so one process can
	// answer as either core.
	const under = <T>(core: 'rust' | 'js', read: () => Result<T>): Result<T> => {
		const previous = process.env['EPIQ_CORE'];
		process.env['EPIQ_CORE'] = core;
		clearEdgeCache();

		try {
			return read();
		} finally {
			if (previous === undefined) delete process.env['EPIQ_CORE'];
			else process.env['EPIQ_CORE'] = previous;
			clearEdgeCache();
		}
	};

	const same = <T>(read: () => Result<T>) => {
		const rust = under('rust', read);
		const js = under('js', read);

		expect(rust.status).toBe('success');
		expect(JSON.stringify(rust)).toBe(JSON.stringify(js));

		return rust;
	};

	it('loads the same events and quarantines', () => {
		const loaded = same(() => loadMergedEventsWithUnreadable(stateRoot));

		expect(loaded.value?.events.length).toBeGreaterThan(19_000);
		expect(loaded.value?.unreadable.map(u => u.reason)).toEqual([
			'corrupt-line',
			'unknown-action',
			'unsupported-schema-version',
		]);
	});

	it('cuts the same way at three times', () => {
		const now = Date.now();

		for (const target of [now, now - 365 * 24 * 60 * 60 * 1000, now - 2e9]) {
			const cut = same(() => loadMergedEventsBefore(stateRoot, target));
			expect(
				(cut.value?.appliedEvents.length ?? 0) +
					(cut.value?.unappliedEvents.length ?? 0),
			).toBeGreaterThan(19_000);
		}
	});

	it('names the same actors, the same effective times, the same edge', () => {
		same(() => loadEventActors(stateRoot));

		// A Map stringifies to `{}`, so its entries are compared instead.
		const times = same(() => {
			const result = loadEffectiveEventTimes(stateRoot);
			return isFail(result)
				? failed(result.message)
				: succeeded(result.message, [...(result.value ?? [])]);
		});
		expect(times.value?.length).toBeGreaterThan(19_000);

		const edge = same(() => getEdgeRef(stateRoot));
		expect(edge.value).toMatch(/^[0-9A-Z]{26}$/);
	});

	it('answers an empty log the same way', () => {
		const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-core-empty-'));

		same(() => loadMergedEventsWithUnreadable(empty));
		same(() => getEdgeRef(empty));
		same(() => loadEventActors(empty));

		fs.rmSync(empty, {recursive: true, force: true});
	});
});
