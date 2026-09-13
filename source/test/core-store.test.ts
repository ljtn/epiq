import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ulid} from 'ulid';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {
	clearEdgeCache,
	loadEventActors,
	loadMergedEventsBefore,
	loadMergedEventsWithUnreadable,
} from '../lib/event/event-load.js';
import {Result} from '../lib/model/result-types.js';
import {generateLog} from './stress/generate-log.js';

// The resident store across the ways a log directory changes between two
// loads. Every step is checked against the TypeScript core, which parses
// from scratch each time: the store's incremental answer must be exactly
// the cold one.
describe('the resident store across changes to the log', () => {
	let stateRoot: string;
	let eventsDir: string;
	let logs: string[];

	beforeAll(async () => {
		stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-core-store-'));
		eventsDir = path.join(stateRoot, '.epiq', 'events');

		await generateLog({
			stateRoot,
			laneIds: ['lane-1', 'lane-2'],
			actors: Array.from({length: 3}, (_, i) => ({
				userId: `01ARZ3NDEKTSV4RRFFQ69G5FA${i}`,
				userName: `person${i}`,
			})),
			events: 3_000,
			years: 1,
			tagNames: ['gui'],
		});

		logs = fs
			.readdirSync(eventsDir)
			.filter(name => name.endsWith('.jsonl'))
			.sort();
	});

	afterAll(() => {
		fs.rmSync(stateRoot, {recursive: true, force: true});
	});

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

	// The Rust side keeps its store and cache between these calls; the JS
	// side reads cold every time. Both readers, so the cut path is covered.
	const agree = () => {
		const cut = Date.now() - 100 * 24 * 60 * 60 * 1000;

		for (const read of [
			() => loadMergedEventsWithUnreadable(stateRoot),
			() => loadMergedEventsBefore(stateRoot, cut),
			() => loadEventActors(stateRoot),
		] as Array<() => Result<unknown>>) {
			const rust = under('rust', read);
			const js = under('js', read);

			expect(rust.status).toBe('success');
			expect(JSON.stringify(rust)).toBe(JSON.stringify(js));
		}

		return under('rust', () => loadMergedEventsWithUnreadable(stateRoot));
	};

	const line = (id: string, ref: string | null, action = 'lock.node') =>
		JSON.stringify({v: 1, id: [id, ref], [action]: {id: 'n'}}) + '\n';

	const lastId = () => {
		const loaded = under('rust', () =>
			loadMergedEventsWithUnreadable(stateRoot),
		);
		return loaded.value?.events.at(-1)?.id ?? null;
	};

	it('a cold load, then the same log again', () => {
		const first = agree();
		const second = agree();

		expect(second.value?.events.length).toBe(first.value?.events.length);
		expect(first.value?.events.length).toBeGreaterThan(2_500);
	});

	it('a line appended to one file', () => {
		const before = agree().value?.events.length ?? 0;

		fs.appendFileSync(path.join(eventsDir, logs[0]!), line(ulid(), lastId()));

		expect(agree().value?.events.length).toBe(before + 1);
	});

	it('a file rewritten to the same length with different content', () => {
		const file = path.join(eventsDir, logs[1]!);
		const content = fs.readFileSync(file, 'utf8');
		const firstLine = content.slice(0, content.indexOf('\n'));
		// One character of the first line's id changed: same length, and a
		// different id from that line on.
		const rewritten =
			firstLine.replace(/"id":\["01/, '"id":["02') +
			content.slice(content.indexOf('\n'));
		fs.writeFileSync(file, rewritten);

		expect(rewritten.length).toBe(content.length);
		agree();
	});

	it('a partial last line, completed later', () => {
		const file = path.join(eventsDir, logs[2]!);
		const whole = line(ulid(), lastId());
		const cutAt = whole.length - 12;

		fs.appendFileSync(file, whole.slice(0, cutAt));
		const partial = agree();
		expect(partial.value?.unreadable.at(-1)?.reason).toBe('corrupt-line');

		fs.appendFileSync(file, whole.slice(cutAt));
		const completed = agree();
		expect(completed.value?.unreadable).toEqual([]);
		expect(completed.value?.events.length).toBe(
			(partial.value?.events.length ?? 0) + 1,
		);
	});

	it('a pending log folded into its tracked file', () => {
		const tracked = logs[0]!;
		const pending = tracked.replace('.', '~pending.');
		const pendingLines = line(ulid(), lastId()) + line(ulid(), null);

		fs.writeFileSync(path.join(eventsDir, pending), pendingLines);
		const withPending = agree();

		// What a flush does: the lines move to the tracked file, the pending
		// file goes.
		fs.appendFileSync(path.join(eventsDir, tracked), pendingLines);
		fs.rmSync(path.join(eventsDir, pending));
		const folded = agree();

		expect(folded.value?.events.length).toBe(withPending.value?.events.length);
	});

	it('a duplicate id arriving in another file, and a file that vanishes', () => {
		const duplicated = ulid();
		fs.appendFileSync(
			path.join(eventsDir, logs[0]!),
			line(duplicated, lastId()),
		);
		const one = agree();

		// The same id from another actor, with content that sorts first.
		fs.appendFileSync(
			path.join(eventsDir, logs[1]!),
			JSON.stringify({
				v: 1,
				id: [duplicated, one.value?.events.at(-2)?.id ?? null],
				'lock.node': {id: 'a'},
			}) + '\n',
		);
		const two = agree();
		expect(two.value?.events.length).toBe(one.value?.events.length);

		fs.rmSync(path.join(eventsDir, logs[2]!));
		agree();
	});
});
