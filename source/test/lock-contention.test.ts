import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {acquireLockFile} from '../git/sync-lock.js';

// Real processes, since a lock's holder is a pid: one in-process loop cannot
// race itself.
const CONTENDER = fileURLToPath(
	new URL('./helpers/lock-contender.ts', import.meta.url),
);
const TSX = fileURLToPath(
	new URL('../../node_modules/.bin/tsx', import.meta.url),
);

const run = (lockPath: string, insidePath: string, rounds: number) =>
	new Promise<{acquired: number; overlaps: number}>((resolve, reject) => {
		const child = spawn(TSX, [CONTENDER, lockPath, insidePath, String(rounds)]);
		let out = '';
		child.stdout.on('data', chunk => (out += chunk));
		child.on('error', reject);
		child.on('close', () => {
			try {
				resolve(JSON.parse(out));
			} catch (error) {
				reject(error);
			}
		});
	});

describe('a lock naming this process that it does not hold', () => {
	// Put back by a breaker that judged it live just as it was let go: nobody
	// else would ever take it, so this process must.
	it('is taken back by this process', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-lock-orphan-'));
		const lockPath = path.join(dir, 'x.lock');
		fs.writeFileSync(
			lockPath,
			JSON.stringify({
				pid: process.pid,
				hostname: os.hostname(),
				startedAt: Date.now(),
				operation: 'fetch',
				token: 'a hold this process let go of',
			}),
		);

		try {
			const lock = acquireLockFile({lockPath, operation: 'fetch'});
			expect(lock).toMatchObject({acquired: true, claim: 'dead'});
			if (lock.acquired) lock.release();
			expect(fs.existsSync(lockPath)).toBe(false);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it('is refused while this process does hold it', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-lock-held-'));
		const lockPath = path.join(dir, 'x.lock');

		try {
			const first = acquireLockFile({lockPath, operation: 'fetch'});
			expect(first.acquired).toBe(true);
			expect(acquireLockFile({lockPath, operation: 'remove'}).acquired).toBe(
				false,
			);
			if (first.acquired) first.release();
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});
});

describe('one lock file, many processes', () => {
	// A lock released between another's failed link and its read was taken
	// for stale, and breaking it removed whatever lock was written there next:
	// two holders at once (RTWMQNB).
	it('is held by one of them at a time', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-lock-race-'));
		const lockPath = path.join(dir, 'x.lock');
		const insidePath = path.join(dir, 'inside');

		try {
			const results = await Promise.all(
				Array.from({length: 6}, () => run(lockPath, insidePath, 150)),
			);

			const acquired = results.reduce((sum, r) => sum + r.acquired, 0);
			const overlaps = results.reduce((sum, r) => sum + r.overlaps, 0);

			expect(acquired).toBeGreaterThan(400);
			expect(overlaps).toBe(0);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	}, 120_000);
});
