import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
	readSnapshot,
	snapshotKey,
	writeSnapshot,
	type SnapshotKey,
} from '../lib/event/snapshot-file.js';

// A snapshot is only a cache: anything it cannot vouch for reads as none.

let dir = '';
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-snapshot-'));
});
afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(dir, {recursive: true, force: true});
});

const key = (overrides: Partial<SnapshotKey> = {}): SnapshotKey => ({
	...snapshotKey({
		actions: ['add.issue', 'edit.title'],
		schemaVersions: [1],
		scope: 'mcp',
		build: 'build-a',
	})!,
	...overrides,
});

const parts = {
	nodes: {a: {id: 'a', title: 'A', nested: [1, 2, {deep: true}]}},
	files: [{name: 'x.jsonl', bytes: 10}],
	big: 'x'.repeat(100_000),
};

describe('a snapshot file', () => {
	it('reads back what was written', () => {
		const file = path.join(dir, 'board.snapshot');
		expect(writeSnapshot(file, key(), parts)).toBe(true);
		expect(readSnapshot(file, key())).toEqual(parts);
	});

	it('is none to a reader with any other key', () => {
		const file = path.join(dir, 'board.snapshot');
		writeSnapshot(file, key(), parts);

		for (const other of [
			{format: 999},
			{v8: 'other-v8'},
			{build: 'build-b'},
			{catalog: 'other-catalog'},
			{scope: 'gui'},
		]) {
			expect(readSnapshot(file, key(other))).toBeNull();
		}
	});

	it('keys on the actions and schema versions it could read', () => {
		const base = {schemaVersions: [1], scope: 'mcp', build: 'b'};
		expect(snapshotKey({...base, actions: ['a', 'b']})!.catalog).not.toBe(
			snapshotKey({...base, actions: ['a', 'b', 'c']})!.catalog,
		);
		expect(
			snapshotKey({...base, actions: ['a'], schemaVersions: [1, 2]})!.catalog,
		).not.toBe(snapshotKey({...base, actions: ['a']})!.catalog);
		expect(snapshotKey({...base, actions: ['b', 'a']})).toEqual(
			snapshotKey({...base, actions: ['a', 'b']}),
		);
	});

	it('is never keyed without a build to key on', () => {
		expect(
			snapshotKey({
				actions: [],
				schemaVersions: [1],
				scope: 'mcp',
				build: null,
			}),
		).toBeNull();
	});

	it('is none when cut short anywhere, or carrying anything after', () => {
		const file = path.join(dir, 'board.snapshot');
		writeSnapshot(file, key(), {nodes: parts.nodes, files: parts.files});
		const whole = fs.readFileSync(file);

		for (let cut = 0; cut < whole.length; cut++) {
			fs.writeFileSync(file, whole.subarray(0, cut));
			expect(readSnapshot(file, key()), `cut at ${cut}`).toBeNull();
		}

		fs.writeFileSync(file, Buffer.concat([whole, Buffer.from([0])]));
		expect(readSnapshot(file, key())).toBeNull();
	});

	it('is none for a missing file or one that is not a snapshot', () => {
		expect(readSnapshot(path.join(dir, 'missing'), key())).toBeNull();
		const file = path.join(dir, 'garbage');
		fs.writeFileSync(file, 'not a snapshot at all');
		expect(readSnapshot(file, key())).toBeNull();
	});

	it('keeps the snapshot it had when a write fails, and leaves nothing behind', () => {
		const file = path.join(dir, 'board.snapshot');
		writeSnapshot(file, key(), parts);

		// A value the serializer refuses fails the write midway.
		expect(writeSnapshot(file, key(), {bad: () => 1})).toBe(false);

		expect(readSnapshot(file, key())).toEqual(parts);
		expect(fs.readdirSync(dir)).toEqual(['board.snapshot']);
	});
});
