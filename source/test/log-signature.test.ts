import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
	accountedSignature,
	accountFor,
	clearAccountedSignature,
	isSettledSignature,
	logSignature,
	noteOwnAppend,
	signatureAfterOwnAppend,
} from '../lib/event/log-signature.js';

// A real directory: what this watches is the log's own files, and a mocked
// filesystem would prove nothing about a teammate's arriving in one.
let root = '';
const eventsDir = () => path.join(root, '.epiq', 'events');
const fileFor = (actor: string) => `${actor}.person.jsonl`;

const write = (actor: string, text: string) =>
	fs.writeFileSync(path.join(eventsDir(), fileFor(actor)), text);

const append = (actor: string, text: string) =>
	fs.appendFileSync(path.join(eventsDir(), fileFor(actor)), text);

// Accounts for the log as a boot does, once every file is past its mtime tick.
const accountSettled = () => {
	const long = new Date(Date.now() - 60_000);
	for (const file of fs.readdirSync(eventsDir())) {
		fs.utimesSync(path.join(eventsDir(), file), long, long);
	}
	accountFor(root, logSignature(root));
	if (accountedSignature(root) === null) throw new Error('not accounted');
};

describe('what this process has accounted for', () => {
	beforeEach(() => {
		clearAccountedSignature();
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-sig-'));
		fs.mkdirSync(eventsDir(), {recursive: true});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(root, {recursive: true, force: true});
	});

	// Nothing holds the directory still between the listing and the stats: a
	// sync in another process renames a pending log twice and deletes it, and
	// git rewrites a tracked log while it rebases. A file gone by then is a
	// directory that moved, and the answer is the directory as it is now.
	describe('when a file goes between the listing and its stat', () => {
		it('lists again rather than throwing', () => {
			write('u-1', 'a\n');
			write('u-2', 'x\n');

			const statSync = fs.statSync;
			vi.spyOn(fs, 'statSync').mockImplementationOnce(((
				...args: Parameters<typeof fs.statSync>
			) => {
				fs.rmSync(path.join(eventsDir(), fileFor('u-2')));
				return statSync(...args);
			}) as typeof fs.statSync);

			const signature = logSignature(root);

			expect(signature).toBe(logSignature(root));
			expect(signature).toContain(fileFor('u-1'));
			expect(signature).not.toContain(fileFor('u-2'));
		});

		it('treats a file still gone after listing again as absent', () => {
			write('u-1', 'a\n');
			write('u-2', 'x\n');

			const statSync = fs.statSync;
			vi.spyOn(fs, 'statSync').mockImplementation(((
				...args: Parameters<typeof fs.statSync>
			) => {
				if (String(args[0]).endsWith(fileFor('u-2'))) {
					throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'});
				}
				return statSync(...args);
			}) as typeof fs.statSync);

			expect(logSignature(root)).toBe(
				`${fileFor('u-1')}:2:${
					statSync(path.join(eventsDir(), fileFor('u-1'))).mtimeMs
				}`,
			);
		});
	});

	// A same-length rewrite inside the tick would share the signature.
	it('does not take a log written a moment ago as accounted for', () => {
		write('u-1', 'a\n');
		// Ahead of now, so it is inside its tick however long the test takes.
		const ahead = new Date(Date.now() + 60_000);
		fs.utimesSync(path.join(eventsDir(), fileFor('u-1')), ahead, ahead);
		accountFor(root, logSignature(root));

		expect(accountedSignature(root)).toBeNull();
	});

	it('waits out a coarse filesystem’s whole-second tick', () => {
		const second = Math.floor(Date.now() / 1000) * 1000 - 60_000;
		const signature = `${fileFor('u-1')}:2:${second}`;

		expect(isSettledSignature(signature, second + 1_500)).toBe(false);
		expect(isSettledSignature(signature, second + 3_500)).toBe(true);
		expect(
			isSettledSignature(`${fileFor('u-1')}:2:${second + 0.5}`, second + 10),
		).toBe(true);
	});

	it('is nothing until something says so', () => {
		expect(accountedSignature(root)).toBeNull();
	});

	it('is only for the project it was taken in', () => {
		accountSettled();

		expect(accountedSignature('/somewhere/else')).toBeNull();
	});

	describe('after this process appends to its own log', () => {
		// The event is in the board before the line is in the file —
		// materializing runs before persisting — so the log growing does not mean
		// the process is behind it.
		it('moves on, so the next read has nothing to catch up on', () => {
			write('u-1', 'a\n');
			accountSettled();

			append('u-1', 'b\n');
			noteOwnAppend(root, fileFor('u-1'), 2);

			expect(accountedSignature(root)).toBe(logSignature(root));
		});

		// The case the whole thing rests on: their events are in the log and not
		// in this board, so claiming to be current would serve a board missing
		// them, quietly, until something else moved.
		it('forgets what it knew when a teammate wrote too', () => {
			write('u-1', 'a\n');
			write('u-2', 'x\n');
			accountSettled();

			append('u-2', 'y\n');
			append('u-1', 'b\n');
			noteOwnAppend(root, fileFor('u-1'), 2);

			expect(accountedSignature(root)).toBeNull();
		});

		it('forgets when a teammate’s log appears', () => {
			write('u-1', 'a\n');
			accountSettled();

			write('u-3', 'z\n');
			append('u-1', 'b\n');
			noteOwnAppend(root, fileFor('u-1'), 2);

			expect(accountedSignature(root)).toBeNull();
		});

		it('forgets when a log disappears', () => {
			write('u-1', 'a\n');
			write('u-2', 'x\n');
			accountSettled();

			fs.rmSync(path.join(eventsDir(), fileFor('u-2')));
			append('u-1', 'b\n');
			noteOwnAppend(root, fileFor('u-1'), 2);

			expect(accountedSignature(root)).toBeNull();
		});

		// One actor's file is shared by every process it runs; a line another of
		// them wrote is not in this board.
		it('forgets when another process of the same actor wrote to its file too', () => {
			write('u-1', 'a\n');
			accountSettled();

			append('u-1', 'theirs\n');
			append('u-1', 'b\n');
			noteOwnAppend(root, fileFor('u-1'), 2);

			expect(accountedSignature(root)).toBeNull();
		});

		it('says nothing about a project it was never given', () => {
			write('u-1', 'a\n');
			append('u-1', 'b\n');
			noteOwnAppend(root, fileFor('u-1'), 2);

			expect(accountedSignature(root)).toBeNull();
		});
	});

	describe('signatureAfterOwnAppend', () => {
		it('is the new signature when only that file moved', () => {
			write('u-1', 'a\n');
			write('u-2', 'x\n');
			const before = logSignature(root);

			append('u-1', 'b\n');

			expect(signatureAfterOwnAppend(root, before, fileFor('u-1'), 2)).toBe(
				logSignature(root),
			);
		});

		it('is null when another moved', () => {
			write('u-1', 'a\n');
			write('u-2', 'x\n');
			const before = logSignature(root);

			append('u-2', 'y\n');

			expect(
				signatureAfterOwnAppend(root, before, fileFor('u-1'), 2),
			).toBeNull();
		});
	});
});
