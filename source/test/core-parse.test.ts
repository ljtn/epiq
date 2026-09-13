import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
	parsePersistedEventsFile,
	ReconstructedEvent,
	UnreadableEvent,
} from '../lib/event/event-load.js';
import {coreCallJson} from '../lib/native/core.js';
import {encodeFrame} from '../lib/native/frame.js';
import {isFail} from '../lib/model/result-types.js';

type Parsed = {events: ReconstructedEvent[]; unreadable: UnreadableEvent[]};

// The TypeScript loader and the Rust parser over the same files: same
// events, same key order, same quarantine entries, or the port is wrong.
describe('epiq-core parse_files against the TypeScript loader', () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	const writeFiles = (files: Record<string, string>): string => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-core-parse-'));
		dirs.push(dir);

		for (const [name, content] of Object.entries(files)) {
			fs.writeFileSync(path.join(dir, name), content);
		}

		return dir;
	};

	const viaTypeScript = (dir: string, names: string[]): Parsed => {
		const unreadable: UnreadableEvent[] = [];
		const events: ReconstructedEvent[] = [];

		for (const name of names) {
			const result = parsePersistedEventsFile(path.join(dir, name), unreadable);
			if (isFail(result) || !result.value) throw new Error(result.message);
			events.push(...result.value);
		}

		return {events, unreadable};
	};

	const viaRust = (dir: string, names: string[]): Parsed => {
		const frame = encodeFrame(
			names.map(name => ({name, data: fs.readFileSync(path.join(dir, name))})),
		);
		const result = coreCallJson<Parsed>('parse_files', frame);
		if (isFail(result) || !result.value) throw new Error(result.message);

		return result.value;
	};

	const line = (value: unknown) => JSON.stringify(value);

	it('agrees on a log with every quarantine kind and every name shape', () => {
		const files = {
			'01ARZ3NDEKTSV4RRFFQ69G5FAV.j.-lampa.jsonl': [
				line({
					v: 1,
					id: ['01H0000000000000000000000A', null],
					'init.workspace': {id: 'ws', name: 'W', rank: 'a0'},
				}),
				'{"v":1,"id":["01H0000000000000000000000B",null],"lock.node"',
				line({
					v: 1,
					id: ['01H0000000000000000000000C', '01H0000000000000000000000A'],
					'edit.title': {id: 'ws', name: 'Renamed', extra: [1, 2.5, 'é', null]},
				}),
				'',
				line({
					v: 2,
					id: ['01H0000000000000000000000D', '01H0000000000000000000000C'],
					'future.action': {id: 'x'},
				}),
				line({v: 1, id: ['', null], 'edit.title': {}}),
				line({id: ['01H0000000000000000000000E', null]}),
				line('a string'),
				'   ',
			].join('\n'),
			'01arz3ndektsv4rrffq69g5fal~pending-01b2c3-f12.alice.jsonl': [
				line({
					'add.issue': {id: 'n', name: 'x', parent: 'ws', rank: 'a1'},
					v: 1,
					id: ['01H0000000000000000000000F', '01H0000000000000000000000C'],
				}),
			].join('\n'),
			'nodot.jsonl': line({
				v: 1,
				id: ['01H0000000000000000000000G', null],
				'add.board': {},
			}),
		};
		const names = Object.keys(files);
		const dir = writeFiles(files);

		const ts = viaTypeScript(dir, names);
		const rust = viaRust(dir, names);

		expect(rust.events.length).toBe(5);
		expect(rust.unreadable.length).toBe(4);
		expect(JSON.stringify(rust)).toBe(JSON.stringify(ts));
	});

	it('fails the read on a file name with an empty user name, as the loader does', () => {
		const dir = writeFiles({'01A..jsonl': ''});

		const ts = parsePersistedEventsFile(path.join(dir, '01A..jsonl'), []);
		const rust = coreCallJson<Parsed>(
			'parse_files',
			encodeFrame([{name: '01A..jsonl', data: new Uint8Array()}]),
		);

		expect(isFail(ts)).toBe(true);
		expect(isFail(rust)).toBe(true);
		expect(rust.message).toContain(ts.message);
	});
});
