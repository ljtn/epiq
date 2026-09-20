import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {
	clearStaleGitLocks,
	execGit,
	execGitAllowFail,
	getGitDir,
	getInProgressGitOperation,
} from '../git/git-utils.js';
import {syncEpiqWithRemote} from '../git/sync.js';
import {acquireSyncLock, SYNC_LOCK_FILE} from '../git/sync-lock.js';
import {isFail} from '../lib/model/result-types.js';
import {setupRepo, useTempHome, writeFile} from './helpers/git-repo.js';

useTempHome();

const OWN_EVENT_FILE = 'u1.alice.jsonl';
const STATE_BRANCH = 'epiq/state';

/** The state worktree, bootstrapped by a first sync the way a board's is. */
const bootstrapped = async (): Promise<{
	repoRoot: string;
	stateBranchRoot: string;
}> => {
	const {repoRoot} = await setupRepo();

	const boot = await syncEpiqWithRemote({
		cwd: repoRoot,
		ownEventFileName: OWN_EVENT_FILE,
	});
	if (isFail(boot)) throw new Error(boot.message);

	return {repoRoot, stateBranchRoot: boot.value.stateBranchRoot};
};

/**
 * A genuine rebase, abandoned in the shape that actually wedges a board.
 *
 * Shape matters here, and it took a killed process to find out why. A rebase
 * stopped on a conflict leaves HEAD detached, and `ensureStateBranchCheckedOut`
 * has always recovered *that* one: it aborts whenever HEAD is not on the state
 * branch. What it returns early on — "already checked out" — is a rebase whose
 * state git has written before it detached anything, which is exactly what a
 * process killed in the first milliseconds of its replay leaves behind. Nothing
 * downstream cleared it, so every later sync met it and refused.
 *
 * So the conflict makes the state real — `git rebase --abort` only unwinds a
 * rebase git itself started, which is why the directory is not faked — and the
 * symbolic-ref puts HEAD back where a kill that early would have left it.
 */
const leaveRebaseInProgress = async (cwd: string): Promise<void> => {
	const file = path.join(cwd, 'conflict.txt');

	writeFile(file, 'base\n');
	await execGit({args: ['add', 'conflict.txt'], cwd});
	await execGit({args: ['commit', '-q', '-m', 'base'], cwd});

	await execGit({args: ['checkout', '-q', '-b', 'other-side'], cwd});
	writeFile(file, 'theirs\n');
	await execGit({args: ['commit', '-q', '-am', 'theirs'], cwd});

	await execGit({args: ['checkout', '-q', '-'], cwd});
	writeFile(file, 'mine\n');
	await execGit({args: ['commit', '-q', '-am', 'mine'], cwd});

	// Conflicts on the line both sides touched, so git stops and keeps its state.
	await execGitAllowFail({args: ['rebase', 'other-side'], cwd});

	// And back onto the branch, leaving the rebase state where it is.
	await execGit({
		args: ['symbolic-ref', 'HEAD', `refs/heads/${STATE_BRANCH}`],
		cwd,
	});

	const branch = await execGit({
		args: ['rev-parse', '--abbrev-ref', 'HEAD'],
		cwd,
	});
	if (isFail(branch)) throw new Error(branch.message);
	if (branch.value.stdout.trim() !== STATE_BRANCH) {
		throw new Error(
			`expected HEAD on ${STATE_BRANCH}, got ${branch.value.stdout}`,
		);
	}

	const operation = await getInProgressGitOperation(cwd);
	if (isFail(operation)) throw new Error(operation.message);
	if (operation.value !== 'rebase in progress') {
		throw new Error(`expected a stopped rebase, got ${operation.value}`);
	}
};

const holdLock = async (
	stateBranchRoot: string,
	holder: Record<string, unknown>,
): Promise<void> => {
	const gitDir = await getGitDir(stateBranchRoot);
	if (isFail(gitDir)) throw new Error(gitDir.message);

	fs.writeFileSync(
		path.join(gitDir.value, 'epiq-sync.lock'),
		JSON.stringify(holder),
	);
};

const operationIn = async (cwd: string): Promise<string | null> => {
	const result = await getInProgressGitOperation(cwd);
	if (isFail(result)) throw new Error(result.message);

	return result.value;
};

/**
 * Sync clears a rebase nobody is running any more, and this is where that is
 * allowed to be true: under the lock, where "nobody is running it" is something
 * the operating system has answered rather than something git was asked to
 * guess. The first test is the one that keeps the second honest.
 */
describe('a rebase left in the state worktree', () => {
	it('is left alone while a live process holds the lock', async () => {
		const {repoRoot, stateBranchRoot} = await bootstrapped();
		await leaveRebaseInProgress(stateBranchRoot);

		// This very process: alive by definition, and holding the worktree.
		await holdLock(stateBranchRoot, {
			pid: process.pid,
			hostname: os.hostname(),
			startedAt: Date.now(),
			operation: 'sync',
		});

		const result = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName: OWN_EVENT_FILE,
		});
		if (isFail(result)) throw new Error(result.message);

		expect(result.value.skipped).toBe(true);
		// The whole point: somebody else's rebase is still standing.
		expect(await operationIn(stateBranchRoot)).toBe('rebase in progress');
	});

	it('is cleared when the lock names a process that is gone', async () => {
		const {repoRoot, stateBranchRoot} = await bootstrapped();
		await leaveRebaseInProgress(stateBranchRoot);

		// The pid is not the point; that it cannot be signalled is.
		await holdLock(stateBranchRoot, {
			pid: 0x7ffffff,
			hostname: os.hostname(),
			startedAt: Date.now(),
			operation: 'sync',
		});

		const result = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName: OWN_EVENT_FILE,
		});
		if (isFail(result)) throw new Error(result.message);

		expect(result.value.skipped).toBeFalsy();
		expect(await operationIn(stateBranchRoot)).toBe(null);
	});

	// The one case liveness cannot settle, and the one place this change could
	// have made things worse: a lock is breakable on age alone after ten
	// minutes, holder alive or not. Before, the process that broke in met the
	// rebase and refused. It must still refuse — breaking a claim is not the
	// same as being told the holder is gone, and a live rebase is not ours.
	it('is left alone when the lock was broken on age from a live holder', async () => {
		const {repoRoot, stateBranchRoot} = await bootstrapped();
		await leaveRebaseInProgress(stateBranchRoot);

		await holdLock(stateBranchRoot, {
			pid: process.pid,
			hostname: os.hostname(),
			startedAt: Date.now() - 60 * 60 * 1000,
			operation: 'sync',
		});

		const result = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName: OWN_EVENT_FILE,
		});

		expect(isFail(result)).toBe(true);
		if (!isFail(result)) return;

		expect(result.message).toContain('rebase in progress');
		expect(await operationIn(stateBranchRoot)).toBe('rebase in progress');
	});

	// A lock file that parses to nothing is what a holder mid-acquisition used
	// to look like for an instant, and what a truncated one looks like for good.
	// Neither says anybody is gone. Found in review of this change: read as
	// "dead", an empty lock let a racing process unwind the rebase of the very
	// holder that was writing it.
	it('is left alone when the lock says nothing at all', async () => {
		const {repoRoot, stateBranchRoot} = await bootstrapped();
		await leaveRebaseInProgress(stateBranchRoot);

		const gitDir = await getGitDir(stateBranchRoot);
		if (isFail(gitDir)) throw new Error(gitDir.message);
		fs.writeFileSync(path.join(gitDir.value, 'epiq-sync.lock'), '');

		const result = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName: OWN_EVENT_FILE,
		});

		expect(isFail(result)).toBe(true);
		if (!isFail(result)) return;

		expect(result.message).toContain('rebase in progress');
		expect(await operationIn(stateBranchRoot)).toBe('rebase in progress');
	});

	it('is cleared when the crashed process left no lock behind', async () => {
		const {repoRoot, stateBranchRoot} = await bootstrapped();
		await leaveRebaseInProgress(stateBranchRoot);

		const result = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName: OWN_EVENT_FILE,
		});
		if (isFail(result)) throw new Error(result.message);

		expect(await operationIn(stateBranchRoot)).toBe(null);
	});
});

// Sync never starts a merge, so one here came from outside epiq — somebody's
// hand on a worktree they were not meant to open. Not this process's to unwind.
describe('a merge in the state worktree', () => {
	it('is refused, and the refusal says where it is', async () => {
		const {repoRoot, stateBranchRoot} = await bootstrapped();

		const gitDir = await getGitDir(stateBranchRoot);
		if (isFail(gitDir)) throw new Error(gitDir.message);

		const head = await execGit({
			args: ['rev-parse', 'HEAD'],
			cwd: stateBranchRoot,
		});
		if (isFail(head)) throw new Error(head.message);
		fs.writeFileSync(
			path.join(gitDir.value, 'MERGE_HEAD'),
			head.value.stdout.trim(),
		);

		const result = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName: OWN_EVENT_FILE,
		});

		expect(isFail(result)).toBe(true);
		if (!isFail(result)) return;

		expect(result.message).toContain('merge in progress');
		expect(result.message).toContain(stateBranchRoot);
		expect(await operationIn(stateBranchRoot)).toBe('merge in progress');
	});
});

// Git takes `<file>.lock` before writing `<file>` and removes it after. A
// process killed in between leaves it, and the next git refuses to write the
// file it guards — which for `index.lock` is the checkout that every sync
// begins with.
describe('lock files a killed git left behind', () => {
	it('are cleared, and the state they guard is not', async () => {
		const {stateBranchRoot} = await bootstrapped();

		const gitDir = await getGitDir(stateBranchRoot);
		if (isFail(gitDir)) throw new Error(gitDir.message);

		fs.writeFileSync(path.join(gitDir.value, 'index.lock'), '');
		fs.writeFileSync(
			path.join(gitDir.value, 'MERGE_MSG.lock'),
			'half a message',
		);
		const keptPath = path.join(gitDir.value, 'MERGE_MSG');
		fs.writeFileSync(keptPath, 'the message itself');

		const cleared = await clearStaleGitLocks(stateBranchRoot);
		if (isFail(cleared)) throw new Error(cleared.message);

		expect([...cleared.value].sort()).toEqual(['MERGE_MSG.lock', 'index.lock']);
		expect(fs.existsSync(path.join(gitDir.value, 'index.lock'))).toBe(false);
		// What the lock guarded is left exactly as it was.
		expect(fs.readFileSync(keptPath, 'utf8')).toBe('the message itself');
		expect(fs.existsSync(path.join(gitDir.value, 'HEAD'))).toBe(true);
	});

	it('leaves a worktree with none of them alone', async () => {
		const {stateBranchRoot} = await bootstrapped();

		const cleared = await clearStaleGitLocks(stateBranchRoot);
		if (isFail(cleared)) throw new Error(cleared.message);

		expect(cleared.value).toEqual([]);
	});

	// epiq's own claim over the worktree lives in this directory and ends in
	// `.lock` like git's. Swept away with the rest, the sync that was holding it
	// would carry on — bootstrap, fetch, rebase, commit, push — with nothing on
	// disk saying so, and the next process along would be free to read the
	// worktree as abandoned and unwind the rebase in it. Found in review.
	it('never takes the sync lock the caller is holding', async () => {
		const {stateBranchRoot} = await bootstrapped();

		const gitDir = await getGitDir(stateBranchRoot);
		if (isFail(gitDir)) throw new Error(gitDir.message);

		const held = await acquireSyncLock({
			worktreeRoot: stateBranchRoot,
			operation: 'sync',
		});
		if (isFail(held) || !held.value.acquired) throw new Error('lock not taken');

		fs.writeFileSync(path.join(gitDir.value, 'index.lock'), '');

		// Exactly the call `ensureSyncReady` makes while it holds the lock.
		const cleared = await clearStaleGitLocks(stateBranchRoot, {
			preserve: [SYNC_LOCK_FILE],
		});
		if (isFail(cleared)) throw new Error(cleared.message);

		expect(cleared.value).toEqual(['index.lock']);
		expect(
			fs.existsSync(path.join(gitDir.value, SYNC_LOCK_FILE)),
			'the sync lock survived its own sweep',
		).toBe(true);

		held.value.release();
	});

	/**
	 * The one that matters, and the one the two above cannot make: that the
	 * sweep *as the sync calls it* spares the sync's own claim.
	 *
	 * Watched rather than inspected afterwards, because by the time a sync
	 * returns it has released the lock either way. A sweep that took it would
	 * show up here as the file going missing while the work carried on — and the
	 * work carrying on unheld is the whole problem: the next process along reads
	 * an unclaimed worktree and is free to unwind the rebase in it.
	 */
	it('keeps the sync holding its lock for the whole of a sync', async () => {
		const {repoRoot, stateBranchRoot} = await bootstrapped();

		const gitDir = await getGitDir(stateBranchRoot);
		if (isFail(gitDir)) throw new Error(gitDir.message);

		// Something for the clearing to do, so the sweep certainly runs.
		fs.writeFileSync(path.join(gitDir.value, 'index.lock'), '');
		const lockPath = path.join(gitDir.value, SYNC_LOCK_FILE);

		let held = false;
		let droppedWhileRunning = false;
		const watch = setInterval(() => {
			if (fs.existsSync(lockPath)) held = true;
			else if (held) droppedWhileRunning = true;
		}, 2);

		const result = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName: OWN_EVENT_FILE,
		});
		clearInterval(watch);

		expect(isFail(result)).toBe(false);
		expect(held, 'the sync took a lock at all').toBe(true);
		expect(
			droppedWhileRunning,
			'the sync lock went missing while the sync was still running',
		).toBe(false);
	});

	// A process killed between writing its holder and publishing it leaves that
	// half of the acquisition behind. Named to be swept, so the next process to
	// hold the worktree tidies it rather than leaving it there for good.
	it('take an acquisition that never finished with them', async () => {
		const {stateBranchRoot} = await bootstrapped();

		const gitDir = await getGitDir(stateBranchRoot);
		if (isFail(gitDir)) throw new Error(gitDir.message);

		const abandoned = path.join(
			gitDir.value,
			`${SYNC_LOCK_FILE}.999999.pending.lock`,
		);
		fs.writeFileSync(abandoned, '{}');

		const cleared = await clearStaleGitLocks(stateBranchRoot, {
			preserve: [SYNC_LOCK_FILE],
		});
		if (isFail(cleared)) throw new Error(cleared.message);

		expect(fs.existsSync(abandoned)).toBe(false);
	});

	// The checkout inside bootstrap is the first thing a sync does, and it is
	// what an `index.lock` stops — before anything that looks at rebases.
	it('do not stop a sync that finds them', async () => {
		const {repoRoot, stateBranchRoot} = await bootstrapped();

		const gitDir = await getGitDir(stateBranchRoot);
		if (isFail(gitDir)) throw new Error(gitDir.message);
		fs.writeFileSync(path.join(gitDir.value, 'index.lock'), '');

		const result = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName: OWN_EVENT_FILE,
		});

		expect(isFail(result)).toBe(false);
		expect(fs.existsSync(path.join(gitDir.value, 'index.lock'))).toBe(false);
	});
});
