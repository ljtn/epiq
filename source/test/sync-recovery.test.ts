import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {
	clearStaleGitLocks,
	clearStaleRefLock,
	execGit,
	execGitAllowFail,
	getGitDir,
	getInProgressGitOperation,
} from '../git/git-utils.js';
import {syncEpiqWithRemote} from '../git/sync.js';
import {acquireSyncLock, SYNC_LOCK_FILE} from '../git/sync-lock.js';
import {isFail} from '../lib/model/result-types.js';
import {
	eventLine,
	getEventsFile,
	setupRepo,
	useTempHome,
	writeFile,
} from './helpers/git-repo.js';

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
 * A real rebase left in progress with HEAD still on the state branch, as a kill
 * early in replay leaves it; `rebase --abort` needs a rebase git started.
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
 * Sync clears an abandoned rebase only under the lock, where liveness comes from
 * the OS, not from git.
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

	// A lock broken on age may still have a live holder, so its rebase isn't ours.
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

	// An empty lock file doesn't say its holder is gone; it may be mid-write.
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

// A process killed mid-write leaves git's `<file>.lock`, and the next git
// refuses that file: for `index.lock`, every sync's checkout.
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

	// epiq's own lock lives here and ends in `.lock` like git's; sweeping it
	// would leave a running sync unclaimed.
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
	 * Watched during the sync, since the lock is released by the time it returns:
	 * the sync's own sweep must spare its claim.
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

	// A half-finished acquisition, named so the next holder sweeps it.
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

/**
 * A killed commit leaves `refs/heads/<branch>.lock` in the common git dir,
 * shared with the user's repo, so the clear removes one named ref, never a walk.
 */
describe('a ref lock in the common git directory', () => {
	const headsDirOf = async (stateBranchRoot: string): Promise<string> => {
		const common = await execGit({
			args: ['rev-parse', '--git-common-dir'],
			cwd: stateBranchRoot,
		});
		if (isFail(common)) throw new Error(common.message);

		return path.join(
			path.resolve(stateBranchRoot, common.value.stdout.trim()),
			'refs',
			'heads',
		);
	};

	const plant = (lockPath: string): void => {
		fs.mkdirSync(path.dirname(lockPath), {recursive: true});
		fs.writeFileSync(lockPath, '');
	};

	it('no longer stops a sync from committing', async () => {
		const {repoRoot, stateBranchRoot} = await bootstrapped();

		const heads = await headsDirOf(stateBranchRoot);
		const refLock = path.join(heads, `${STATE_BRANCH}.lock`);
		plant(refLock);

		// Something to commit, which is what needs the ref: a sync with nothing
		// to write never asks for it and passes over the lock either way.
		writeFile(
			getEventsFile({root: stateBranchRoot, fileName: OWN_EVENT_FILE}),
			eventLine('01H00000000000000000000009'),
		);

		const result = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName: OWN_EVENT_FILE,
		});
		if (isFail(result)) throw new Error(result.message);

		expect(result.value.createdCommit).toBe(true);
		expect(fs.existsSync(refLock)).toBe(false);
	});

	// The common directory is the user's as much as epiq's, and a lock on their
	// branch is their commit in progress.
	it('is never cleared for a branch that belongs to somebody else', async () => {
		const {repoRoot, stateBranchRoot} = await bootstrapped();

		const heads = await headsDirOf(stateBranchRoot);
		const theirs = path.join(heads, 'main.lock');
		plant(theirs);

		writeFile(
			getEventsFile({root: stateBranchRoot, fileName: OWN_EVENT_FILE}),
			eventLine('01H0000000000000000000000A'),
		);

		const result = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName: OWN_EVENT_FILE,
		});
		if (isFail(result)) throw new Error(result.message);

		expect(fs.existsSync(theirs), "somebody else's ref lock").toBe(true);
	});

	// The branch name comes out of the project file, so it is repository data.
	it('refuses a branch name that would reach outside refs/heads', async () => {
		const {stateBranchRoot} = await bootstrapped();

		const escaped = await clearStaleRefLock(stateBranchRoot, '../../../evil');

		expect(isFail(escaped)).toBe(true);
	});
});
