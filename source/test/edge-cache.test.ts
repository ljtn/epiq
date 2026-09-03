import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {ulid} from 'ulid';

import {
	advanceEdgeRef,
	clearEdgeCache,
	getEdgeRef,
} from '../lib/event/event-load.js';

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
			advanceEdgeRef(root, fileFor('u-1'), mine);

			expect(getEdgeRef(root).value).toBe(mine);
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
			advanceEdgeRef(root, fileFor('u-1'), mine);

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
			advanceEdgeRef(root, fileFor('u-1'), mine);

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
			advanceEdgeRef(root, fileFor('u-1'), mine);

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
