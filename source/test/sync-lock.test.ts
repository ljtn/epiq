import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {beforeEach, describe, expect, it} from 'vitest';
import {execGit, getGitDir} from '../git/git-utils.js';
import {acquireSyncLock, withSyncLock} from '../git/sync-lock.js';
import {isFail} from '../lib/model/result-types.js';
import {makeTempDir} from './helpers/git-repo.js';

/**
 * The distinction this exists to make: a lock held by a process that is still
 * running must be respected, and one left behind by a process that is gone must
 * not wedge the worktree forever. Git cannot tell those apart, which is why
 * `rebase --abort` recovered from a crash by destroying a live sync.
 */
describe('sync lock', () => {
	let worktree: string;
	let lockPath: string;

	const writeLock = (holder: Record<string, unknown>) =>
		fs.writeFileSync(lockPath, JSON.stringify(holder));

	beforeEach(async () => {
		worktree = makeTempDir();
		await execGit({args: ['init', '-q', '-b', 'main', '.'], cwd: worktree});

		const gitDir = await getGitDir(worktree);
		if (isFail(gitDir)) throw new Error(gitDir.message);
		lockPath = path.join(gitDir.value, 'epiq-sync.lock');
	});

	it('acquires when nobody holds it, and releases after', async () => {
		const result = await acquireSyncLock({
			worktreeRoot: worktree,
			operation: 'sync',
		});

		expect(isFail(result)).toBe(false);
		if (isFail(result) || !result.value.acquired) throw new Error('not held');

		expect(fs.existsSync(lockPath)).toBe(true);
		result.value.release();
		expect(fs.existsSync(lockPath)).toBe(false);
	});

	// The whole point: process 1 is mid-rebase, process 2 must not touch it.
	it('refuses while a live process holds it', async () => {
		writeLock({
			pid: process.pid,
			hostname: os.hostname(),
			startedAt: Date.now(),
			operation: 'sync',
		});

		const result = await acquireSyncLock({
			worktreeRoot: worktree,
			operation: 'sync',
		});

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value.acquired).toBe(false);
	});

	// The other half: a crashed sync must not lock the board out permanently.
	it('breaks a lock whose holder is gone', async () => {
		// Vanishingly unlikely to be live, and the liveness check is what decides
		// — not the number itself.
		writeLock({
			pid: 0x7ffffff,
			hostname: os.hostname(),
			startedAt: Date.now(),
			operation: 'sync',
		});

		const result = await acquireSyncLock({
			worktreeRoot: worktree,
			operation: 'sync',
		});

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value.acquired).toBe(true);
	});

	it('breaks a lock left by a live process that has held it far too long', async () => {
		writeLock({
			pid: process.pid,
			hostname: os.hostname(),
			startedAt: Date.now() - 60 * 60 * 1000,
			operation: 'sync',
		});

		const result = await acquireSyncLock({
			worktreeRoot: worktree,
			operation: 'sync',
		});

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value.acquired).toBe(true);
	});

	// A half-written lock has no holder to protect, and leaving it would wedge
	// the worktree with no way out.
	it('breaks an unreadable lock', async () => {
		fs.writeFileSync(lockPath, '{"pid": ');

		const result = await acquireSyncLock({
			worktreeRoot: worktree,
			operation: 'sync',
		});

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value.acquired).toBe(true);
	});

	// Another host's pid means nothing here, so only age may settle it.
	it('respects a fresh lock from another machine', async () => {
		writeLock({
			pid: 0x7ffffff,
			hostname: `${os.hostname()}-elsewhere`,
			startedAt: Date.now(),
			operation: 'sync',
		});

		const result = await acquireSyncLock({
			worktreeRoot: worktree,
			operation: 'sync',
		});

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value.acquired).toBe(false);
	});

	describe('withSyncLock', () => {
		it('runs the work and releases even when it throws', async () => {
			await expect(
				withSyncLock({
					worktreeRoot: worktree,
					operation: 'sync',
					fn: async () => {
						throw new Error('boom');
					},
				}),
			).rejects.toThrow('boom');

			expect(fs.existsSync(lockPath)).toBe(false);
		});

		it('skips the work entirely when the lock is held', async () => {
			writeLock({
				pid: process.pid,
				hostname: os.hostname(),
				startedAt: Date.now(),
				operation: 'sync',
			});

			let ran = false;
			const result = await withSyncLock({
				worktreeRoot: worktree,
				operation: 'sync',
				fn: async () => {
					ran = true;
					return 'done';
				},
			});

			expect(isFail(result)).toBe(false);
			if (isFail(result)) return;
			expect(result.value).toBeNull();
			expect(ran).toBe(false);

			// Somebody else's lock is still theirs afterwards.
			expect(fs.existsSync(lockPath)).toBe(true);
		});

		it('does not hand the lock to two callers at once', async () => {
			let concurrent = 0;
			let peak = 0;

			const attempt = () =>
				withSyncLock({
					worktreeRoot: worktree,
					operation: 'sync',
					fn: async () => {
						concurrent += 1;
						peak = Math.max(peak, concurrent);
						await new Promise(resolve => setTimeout(resolve, 30));
						concurrent -= 1;
						return true;
					},
				});

			await Promise.all([attempt(), attempt(), attempt()]);

			expect(peak).toBe(1);
		});
	});
});
