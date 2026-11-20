import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ulid} from '../lib/event/ulid.js';

import {
	advanceEdgeRef,
	advanceSortedLog,
	clearEdgeCache,
	getEdgeRef,
	loadOrderedEntries,
} from '../lib/board/board-log.js';

// A real directory, because what the cache watches is the log's own files and a
// mocked filesystem would prove nothing about a teammate's arriving in it.
let root = '';
const eventsDir = () => path.join(root, '.epiq', 'events');

const fileFor = (actor: string) => `${actor}.person.jsonl`;

const line = (id: string, refId: string | null) =>
	`${JSON.stringify({
		'add.issue': {id: ulid(), name: 'x', parent: 'lane', rank: 'aQ'},
		v: 1,
		id: [id, refId],
	})}\n`;

// A chain in one actor's file, returning the last id — the causal tail.
const writeChain = (actor: string, count: number, from: number): string => {
	let previous: string | null = null;
	let text = '';

	for (let i = 0; i < count; i++) {
		const id = ulid(from + i);
		text += line(id, previous);
		previous = id;
	}

	fs.writeFileSync(path.join(eventsDir(), fileFor(actor)), text);

	return previous!;
};

const baseTime = 1_700_000_000_000;

describe('the causal edge', () => {
	beforeEach(() => {
		clearEdgeCache();
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-edge-'));
		fs.mkdirSync(eventsDir(), {recursive: true});
	});

	afterEach(() => {
		fs.rmSync(root, {recursive: true, force: true});
	});

	it('is the tail of the order', () => {
		const tail = writeChain('u-1', 4, baseTime);

		expect(getEdgeRef(root).value).toBe(tail);
	});

	it('is null for a log with nothing in it', () => {
		expect(getEdgeRef(root).value).toBeNull();
	});

	// The point of the whole thing: reading it meant reading every line the
	// board has ever held, on every write.
	it('is not re-derived while the log has not moved', () => {
		const tail = writeChain('u-1', 4, baseTime);
		expect(getEdgeRef(root).value).toBe(tail);

		// The files say something else now, but their size and mtime do not — so
		// a cache that re-read would notice and one that trusts the signature
		// will not. Which is what proves it did not read.
		fs.writeFileSync(
			path.join(eventsDir(), fileFor('u-1')),
			fs.readFileSync(path.join(eventsDir(), fileFor('u-1')), 'utf8'),
		);
		const stat = fs.statSync(path.join(eventsDir(), fileFor('u-1')));
		fs.utimesSync(
			path.join(eventsDir(), fileFor('u-1')),
			stat.atime,
			stat.mtime,
		);

		expect(getEdgeRef(root).value).toBe(tail);
	});

	describe('after this actor writes', () => {
		it('moves on to what was written, without reading the log', () => {
			writeChain('u-1', 4, baseTime);
			getEdgeRef(root);

			const mine = ulid(baseTime + 100);
			fs.appendFileSync(
				path.join(eventsDir(), fileFor('u-1')),
				line(mine, null),
			);
			advanceEdgeRef(
				root,
				fileFor('u-1'),
				mine,
				Buffer.byteLength(line(mine, null)),
			);

			expect(getEdgeRef(root).value).toBe(mine);
		});

		// One actor's file is written by every process it runs: a line another
		// of them appended is a tail this process never decided.
		it('gives up the shortcut when another process of the same actor wrote too', () => {
			const tail = writeChain('u-1', 4, baseTime);
			getEdgeRef(root);

			const theirs = ulid(baseTime + 1000);
			const file = path.join(eventsDir(), fileFor('u-1'));
			fs.appendFileSync(file, line(theirs, tail));

			const mine = ulid(baseTime + 100);
			const own = line(mine, tail);
			fs.appendFileSync(file, own);
			advanceEdgeRef(root, fileFor('u-1'), mine, Buffer.byteLength(own));

			expect(getEdgeRef(root).value).toBe(theirs);
		});

		// The case the correctness rests on. A board with one writer would not
		// need the check at all.
		it('gives up the shortcut when a teammate wrote too', () => {
			writeChain('u-1', 4, baseTime);
			getEdgeRef(root);

			const theirs = writeChain('u-2', 3, baseTime + 1000);

			const mine = ulid(baseTime + 100);
			fs.appendFileSync(
				path.join(eventsDir(), fileFor('u-1')),
				line(mine, null),
			);
			advanceEdgeRef(
				root,
				fileFor('u-1'),
				mine,
				Buffer.byteLength(line(mine, null)),
			);

			// Derived rather than assumed, and their events sort last here.
			expect(getEdgeRef(root).value).toBe(theirs);
		});

		it('gives up the shortcut when a teammate’s log appears', () => {
			writeChain('u-1', 4, baseTime);
			getEdgeRef(root);

			const theirs = writeChain('u-3', 2, baseTime + 5000);

			const mine = ulid(baseTime + 100);
			fs.appendFileSync(
				path.join(eventsDir(), fileFor('u-1')),
				line(mine, null),
			);
			advanceEdgeRef(
				root,
				fileFor('u-1'),
				mine,
				Buffer.byteLength(line(mine, null)),
			);

			expect(getEdgeRef(root).value).toBe(theirs);
		});

		it('gives up the shortcut when a log disappears', () => {
			writeChain('u-1', 4, baseTime);
			writeChain('u-2', 2, baseTime + 1000);
			getEdgeRef(root);

			fs.rmSync(path.join(eventsDir(), fileFor('u-2')));

			const mine = ulid(baseTime + 100);
			fs.appendFileSync(
				path.join(eventsDir(), fileFor('u-1')),
				line(mine, null),
			);
			advanceEdgeRef(
				root,
				fileFor('u-1'),
				mine,
				Buffer.byteLength(line(mine, null)),
			);

			// Re-derived over what is left, rather than trusting a tail taken
			// while the missing file was still there.
			expect(getEdgeRef(root).value).toBe(mine);
		});
	});

	it('serves a different project without answering from the first', () => {
		const tail = writeChain('u-1', 4, baseTime);
		expect(getEdgeRef(root).value).toBe(tail);

		const other = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-edge-'));
		fs.mkdirSync(path.join(other, '.epiq', 'events'), {recursive: true});

		expect(getEdgeRef(other).value).toBeNull();

		fs.rmSync(other, {recursive: true, force: true});
	});
});

// The ordered log, extended by this process's own line rather than read again.
describe('the ordered log after an own append', () => {
	beforeEach(() => {
		clearEdgeCache();
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-sorted-'));
		fs.mkdirSync(eventsDir(), {recursive: true});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(root, {recursive: true, force: true});
	});

	const settle = () => {
		const long = new Date(Date.now() - 60_000);
		for (const file of fs.readdirSync(eventsDir())) {
			fs.utimesSync(path.join(eventsDir(), file), long, long);
		}
	};

	// As persist does: the line into this actor's pending log, then the hook.
	const appendOwn = (id: string, parent: string) => {
		const filePath = path.join(eventsDir(), 'u-1~pending-x-1.person.jsonl');
		const text = line(id, parent);
		fs.appendFileSync(filePath, text);
		advanceSortedLog(root, filePath, text, Buffer.byteLength(text));
	};

	const loadIds = () =>
		(loadOrderedEntries(root).value ?? []).map(entry => entry.id[0]);

	const freshOrder = () => {
		clearEdgeCache();
		return loadOrderedEntries(root).value;
	};

	it('places it last, as reading the log again would, without reading it', () => {
		const tail = writeChain('u-1', 4, baseTime);
		settle();
		loadOrderedEntries(root);

		appendOwn(ulid(baseTime + 10), tail);
		const read = vi.spyOn(fs, 'readFileSync');
		const extended = loadOrderedEntries(root).value;
		expect(read).not.toHaveBeenCalled();
		read.mockRestore();

		expect(extended).toEqual(freshOrder());
	});

	it('keeps extending across a run of own appends', () => {
		const tail = writeChain('u-1', 4, baseTime);
		settle();
		loadOrderedEntries(root);

		const first = ulid(baseTime + 10);
		appendOwn(first, tail);
		appendOwn(ulid(baseTime + 11), first);
		const read = vi.spyOn(fs, 'readFileSync');
		const extended = loadOrderedEntries(root).value;
		expect(read).not.toHaveBeenCalled();
		read.mockRestore();

		expect(extended).toEqual(freshOrder());
	});

	// A hostile line can name an id as its parent before that id exists: held
	// as an orphan, it moves under the new event once that is there.
	it('reads the log again when a held line already waits on the new id', () => {
		const tail = writeChain('u-1', 4, baseTime);
		const next = ulid(baseTime + 10);
		fs.writeFileSync(
			path.join(eventsDir(), fileFor('u-2')),
			line(ulid(baseTime - 5), next),
		);
		settle();
		expect(loadOrderedEntries(root).value?.at(-1)?.id[0]).toBe(tail);

		appendOwn(next, tail);

		expect(loadOrderedEntries(root).value).toEqual(freshOrder());
	});

	// The order keeps one event per id, wherever it was placed first.
	it('reads the log again when the new id is already held', () => {
		const tail = writeChain('u-1', 4, baseTime);
		const first = loadIds()[0]!;
		const taken = ulid(baseTime);
		fs.writeFileSync(
			path.join(eventsDir(), fileFor('u-2')),
			line(taken, first),
		);
		settle();
		clearEdgeCache();
		expect(loadOrderedEntries(root).value?.at(-1)?.id[0]).toBe(tail);

		appendOwn(taken, tail);

		expect(loadOrderedEntries(root).value).toEqual(freshOrder());
	});
});
