import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ulid} from 'ulid';
import {afterEach, describe, expect, it} from 'vitest';
import {
	effectiveEventTimes,
	getSortedEvents,
	parsePersistedEventsFile,
	ReconstructedEvent,
	splitEventsAtTime,
	UnreadableEvent,
} from '../lib/event/event-load.js';
import {coreCallJson} from '../lib/native/core.js';
import {encodeFrame} from '../lib/native/frame.js';
import {isFail} from '../lib/model/result-types.js';

type Loaded = {
	events: ReconstructedEvent[];
	unappliedEvents?: ReconstructedEvent[];
	unreadable: UnreadableEvent[];
	edge: string | null;
	times?: [string, number | null][];
};

const CENTURY_MS = 100 * 365 * 24 * 60 * 60 * 1000;

// A cut at a time, the effective times behind it, and the edge: the
// TypeScript answer and the Rust answer over the same log, byte for byte.
describe('epiq-core load against splitEventsAtTime and effectiveEventTimes', () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	const writeLog = (
		lines: {id: string; ref: string | null; action?: string}[],
	): string => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-core-times-'));
		dirs.push(dir);

		fs.writeFileSync(
			path.join(dir, '01ARZ3NDEKTSV4RRFFQ69G5FAV.alice.jsonl'),
			lines
				.map(({id, ref, action = 'x'}) =>
					JSON.stringify({v: 1, id: [id, ref], [action]: {id: 'n'}}),
				)
				.join('\n') + '\n',
		);

		return dir;
	};

	const sortedViaTypeScript = (dir: string): ReconstructedEvent[] => {
		const result = parsePersistedEventsFile(
			path.join(dir, '01ARZ3NDEKTSV4RRFFQ69G5FAV.alice.jsonl'),
			[],
		);
		if (isFail(result) || !result.value) throw new Error(result.message);

		return getSortedEvents(result.value);
	};

	const viaRust = (
		dir: string,
		params: {now: number; splitAt?: number; times?: boolean},
	): Loaded => {
		const name = '01ARZ3NDEKTSV4RRFFQ69G5FAV.alice.jsonl';
		const frame = encodeFrame([
			{name: '@params', data: new TextEncoder().encode(JSON.stringify(params))},
			{name, data: fs.readFileSync(path.join(dir, name))},
		]);
		const result = coreCallJson<Loaded>('load', frame);
		if (isFail(result) || !result.value) throw new Error(result.message);

		return result.value;
	};

	it('agrees on a cut through honest, poisoned, invalid and orphaned ids', () => {
		const now = Date.now();
		const root = ulid(now - 60_000);
		const poisoned = ulid(now + CENTURY_MS);
		const child = ulid(now - 40_000);
		const late = ulid(now + 10_000);
		const lateChild = ulid(now - 5_000);
		const grandChild = ulid(now - 20_000);
		const dir = writeLog([
			{id: root, ref: null, action: 'init.workspace'},
			{id: poisoned, ref: root},
			{id: child, ref: poisoned},
			{id: grandChild, ref: child},
			{id: late, ref: root},
			{id: lateChild, ref: late},
			{id: 'not-a-valid-ulid', ref: root},
			{id: ulid(now - 30_000), ref: 'gone'},
		]);

		const sorted = sortedViaTypeScript(dir);

		for (const target of [now, now - 30_000, now - 100_000]) {
			const ts = splitEventsAtTime(sorted, target);
			const rust = viaRust(dir, {now, splitAt: target});

			expect(rust.events.map(e => e.id[0])).toEqual(
				ts.appliedEvents.map(e => e.id[0]),
			);
			expect(JSON.stringify(rust.events)).toBe(
				JSON.stringify(ts.appliedEvents),
			);
			expect(JSON.stringify(rust.unappliedEvents)).toBe(
				JSON.stringify(ts.unappliedEvents),
			);
			expect(rust.edge).toBe(sorted.at(-1)?.id[0] ?? null);
		}
	});

	it('agrees on every effective time', () => {
		const now = Date.now();
		const root = ulid(now - 60_000);
		const poisoned = ulid(now + CENTURY_MS);
		const poisonedToo = ulid(now + 2 * CENTURY_MS);
		const dir = writeLog([
			{id: root, ref: null, action: 'init.workspace'},
			{id: poisoned, ref: root},
			{id: poisonedToo, ref: poisoned},
			{id: 'not-a-valid-ulid', ref: root},
			{id: ulid(now - 1_000), ref: root},
		]);

		const sorted = sortedViaTypeScript(dir);
		const ts = effectiveEventTimes(sorted).map((time, index) => [
			sorted[index]!.id[0],
			time,
		]);
		const rust = viaRust(dir, {now, times: true});

		expect(rust.times).toEqual(ts);
	});

	it('leaves the order and the edge alone without a cut', () => {
		const now = Date.now();
		const root = ulid(now - 60_000);
		const child = ulid(now - 30_000);
		const dir = writeLog([
			{id: child, ref: root},
			{id: root, ref: null, action: 'init.workspace'},
		]);

		const rust = viaRust(dir, {now});

		expect(rust.events.map(e => e.id[0])).toEqual([root, child]);
		expect(rust.unappliedEvents).toBeUndefined();
		expect(rust.times).toBeUndefined();
		expect(rust.edge).toBe(child);
	});
});
