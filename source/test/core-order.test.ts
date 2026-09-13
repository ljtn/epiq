import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
	getSortedEvents,
	parsePersistedEventsFile,
	ReconstructedEvent,
	UnreadableEvent,
} from '../lib/event/event-load.js';
import {coreCallJson} from '../lib/native/core.js';
import {encodeFrame} from '../lib/native/frame.js';
import {isFail} from '../lib/model/result-types.js';
import {generateLog} from './stress/generate-log.js';

type Loaded = {events: ReconstructedEvent[]; unreadable: UnreadableEvent[]};

// The TypeScript order and the Rust order over the same files, byte for byte.
describe('epiq-core load_files against getSortedEvents', () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	const tempDir = () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-core-order-'));
		dirs.push(dir);
		return dir;
	};

	const logNames = (eventsDir: string) =>
		fs
			.readdirSync(eventsDir)
			.filter(name => name.endsWith('.jsonl'))
			.sort();

	const viaTypeScript = (eventsDir: string): Loaded => {
		const unreadable: UnreadableEvent[] = [];
		const events: ReconstructedEvent[] = [];

		for (const name of logNames(eventsDir)) {
			const result = parsePersistedEventsFile(
				path.join(eventsDir, name),
				unreadable,
			);
			if (isFail(result) || !result.value) throw new Error(result.message);
			events.push(...result.value);
		}

		return {events: getSortedEvents(events), unreadable};
	};

	const viaRust = (eventsDir: string): Loaded => {
		const frame = encodeFrame(
			logNames(eventsDir).map(name => ({
				name,
				data: fs.readFileSync(path.join(eventsDir, name)),
			})),
		);
		const result = coreCallJson<Loaded>('load_files', frame);
		if (isFail(result) || !result.value) throw new Error(result.message);

		return result.value;
	};

	const line = (value: unknown) => JSON.stringify(value);

	it('agrees on a hostile log: forged roots, duplicate ids, cycles, orphans, corrupt lines', () => {
		const eventsDir = tempDir();
		const A = '01H0000000000000000000000A';
		const B = '01H0000000000000000000000B';
		const C = '01H0000000000000000000000C';

		fs.writeFileSync(
			path.join(eventsDir, '01ARZ3NDEKTSV4RRFFQ69G5FAV.alice.jsonl'),
			[
				line({v: 1, id: [B, A], 'edit.title': {id: 'ws', name: 'Renamed'}}),
				line({
					v: 1,
					id: [A, null],
					'init.workspace': {id: 'ws', name: 'W', rank: 'a0'},
				}),
				line({
					v: 1,
					id: ['00Z', null],
					'edit.title': {id: 'ws', name: 'Forged'},
				}),
				line({
					v: 1,
					id: ['00Y', null],
					'init.workspace': {id: 'ws'},
					evil: true,
				}),
				line({v: 1, id: ['01Y', '01Z'], 'lock.node': {id: 'ws'}}),
				line({v: 1, id: ['01Z', '01Y'], 'lock.node': {id: 'ws'}}),
				line({v: 1, id: [C, 'gone'], 'edit.title': {id: 'ws', name: 'Orphan'}}),
				'{"v":1,"id":["01H0000000000000000000000D",null],"lock.node"',
				line({
					v: 2,
					id: ['01H0000000000000000000000E', B],
					'future.action': {id: 'x'},
				}),
			].join('\n') + '\n',
		);
		fs.writeFileSync(
			path.join(eventsDir, '01ARZ3NDEKTSV4RRFFQ69G5FAW.bob.jsonl'),
			[
				// The same id as alice's B, from another log: a tie settled by content.
				line({
					v: 1,
					id: [B, A],
					'edit.title': {id: 'ws', name: 'Renamed by Bob'},
				}),
				line({v: 1, id: ['b1', A], 'edit.title': {id: 'ws', name: 'b'}}),
				line({v: 1, id: ['A1', A], 'edit.title': {id: 'ws', name: 'A'}}),
				line({v: 1, id: ['a1', A], 'edit.title': {id: 'ws', name: 'a'}}),
			].join('\n') + '\n',
		);

		const ts = viaTypeScript(eventsDir);
		const rust = viaRust(eventsDir);

		expect(rust.events.map(e => e.id[0])).toEqual(ts.events.map(e => e.id[0]));
		expect(JSON.stringify(rust)).toBe(JSON.stringify(ts));
	});

	it('agrees on a generated multi-actor log', async () => {
		const stateRoot = tempDir();

		await generateLog({
			stateRoot,
			laneIds: ['lane-1', 'lane-2', 'lane-3'],
			actors: Array.from({length: 5}, (_, i) => ({
				userId: `01ARZ3NDEKTSV4RRFFQ69G5FA${i}`,
				userName: `person${i}`,
			})),
			events: 5_000,
			years: 2,
			tagNames: ['gui', 'bug'],
		});

		const eventsDir = path.join(stateRoot, '.epiq', 'events');
		const ts = viaTypeScript(eventsDir);
		const rust = viaRust(eventsDir);

		expect(rust.events.length).toBe(ts.events.length);
		expect(rust.events.length).toBeGreaterThan(4_000);
		expect(JSON.stringify(rust)).toBe(JSON.stringify(ts));
	});
});
