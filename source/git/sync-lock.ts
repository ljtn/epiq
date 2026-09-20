import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {getGitDir} from './git-utils.js';
import {logger} from '../logger.js';

/**
 * A cross-process lock over the state branch worktree.
 *
 * `runExclusive` serializes work inside one process; it is a promise chain and
 * dies with the process, so it says nothing about the several other processes
 * writing this same worktree — a TUI, a GUI autosync, an MCP server per agent.
 *
 * The case that forced this: `ensureStateBranchCheckedOut` runs
 * `git rebase --abort` whenever HEAD is not on the state branch, and mid-rebase
 * HEAD is detached. A live sync's rebase and a rebase abandoned by a crashed
 * process are indistinguishable from git alone, so aborting recovered from the
 * second by destroying the first. Whether a process still holds the worktree is
 * not something git knows, but it is something the operating system knows.
 *
 * Advisory, deliberately: it binds epiq processes, not a person running git in
 * the worktree by hand. Git's own `index.lock` and `rebase-merge/` remain the
 * hard boundary. Every writer here is an epiq process, so in practice this
 * covers the cases that actually occur.
 *
 * Assumes the worktree is on a local filesystem, which `~/.epiq-global` is.
 * `pid` means nothing across hosts and `wx` is not reliably atomic on NFS, so
 * `hostname` is recorded and a lock from elsewhere is never broken on liveness.
 */

/**
 * Exported because it is a name two processes agree on, not an implementation
 * detail: anything sweeping this directory has to leave it alone, and renaming
 * it would mean an old build and a new one no longer seeing each other's
 * claims.
 */
export const SYNC_LOCK_FILE = 'epiq-sync.lock';

/**
 * Backstop for the one case liveness cannot settle: a dead holder whose pid has
 * been recycled by an unrelated process. Generous — every git call this lock
 * spans already caps itself at 10s, and being wrong here means breaking a live
 * lock, which is the failure this whole mechanism exists to avoid.
 */
const STALE_AFTER_MS = 10 * 60 * 1000;

type LockHolder = {
	pid: number;
	hostname: string;
	startedAt: number;
	operation: string;
};

/**
 * How the lock came to be ours, which is not the same question as whether it
 * is. `clean` is an empty file; `dead` is a holder the operating system says is
 * gone. `stale` is the awkward one — a holder still running, whose claim was
 * broken on age alone — and a caller about to do something irreversible to the
 * worktree wants to know it is standing on that rather than on the other two.
 */
export type LockClaim = 'clean' | 'dead' | 'stale';

export type LockOutcome =
	| {acquired: true; claim: LockClaim; release: () => void}
	| {acquired: false; heldBy: LockHolder};

const parseHolder = (raw: string): LockHolder | null => {
	try {
		const value = JSON.parse(raw) as Partial<LockHolder>;

		if (
			typeof value.pid !== 'number' ||
			typeof value.hostname !== 'string' ||
			typeof value.startedAt !== 'number' ||
			typeof value.operation !== 'string'
		) {
			return null;
		}

		return value as LockHolder;
	} catch {
		return null;
	}
};

/**
 * `kill(pid, 0)` sends nothing; it only asks whether the pid can be signalled.
 * `EPERM` means the process exists but belongs to another user — alive, and
 * emphatically not ours to break.
 */
const isProcessAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
};

/** What claim we have over a lock somebody else wrote, if any. */
const claimOver = (holder: LockHolder | null): LockClaim | null => {
	// A lock that says nothing is still broken — leaving it would wedge the
	// worktree — but it is not evidence that anybody is gone, and it must not be
	// read as licence to unwind what they are running. A holder mid-acquisition
	// looks exactly like this for the instant between creating the file and
	// filling it, which `write` above now closes; a truncated one looks like it
	// for good. `stale` is the honest answer to both: take the worktree, touch
	// nothing in it.
	if (!holder) return 'stale';

	// Another machine's pid is not ours to interpret, so only age can settle it.
	if (holder.hostname !== os.hostname()) {
		return Date.now() - holder.startedAt > STALE_AFTER_MS ? 'stale' : null;
	}

	if (!isProcessAlive(holder.pid)) return 'dead';

	return Date.now() - holder.startedAt > STALE_AFTER_MS ? 'stale' : null;
};

export const describeHolder = (holder: LockHolder): string =>
	`${holder.operation} (pid ${holder.pid} on ${
		holder.hostname
	}, started ${new Date(holder.startedAt).toISOString()})`;

const readHolder = (lockPath: string): LockHolder | null => {
	try {
		return parseHolder(fs.readFileSync(lockPath, 'utf8'));
	} catch {
		// Gone between the failed write and this read: another process released
		// it, which is the same as never having held it.
		return null;
	}
};

/**
 * Writes the holder, then claims the lock with it — in that order, and as one
 * step for anybody watching.
 *
 * `wx` alone creates the file and fills it in a second call, so between the two
 * the lock exists and is empty. A process arriving in that gap reads nothing,
 * has no holder to respect, and treats a live claim as an abandoned one. Since
 * `TATEM5B` that is not merely a broken lock: an abandoned claim is grounds for
 * unwinding the rebase the holder is running.
 *
 * `link` is the fix, because it is one syscall that both fails when the target
 * exists and publishes a file that is already complete. The temporary name is
 * this process's own, so two of them cannot collide over it.
 */
const write = (lockPath: string, operation: string): boolean => {
	const holder: LockHolder = {
		pid: process.pid,
		hostname: os.hostname(),
		startedAt: Date.now(),
		operation,
	};

	// Ends in `.lock` on purpose: a process killed between the write and the
	// link leaves this behind, and a name the sweep recognises is one that gets
	// tidied by whoever holds the worktree next rather than one nothing ever
	// collects.
	//
	// A sweep can still take this file mid-acquisition — the sweeper holds the
	// lock, which means the link below was going to fail anyway. It fails with
	// ENOENT instead of EEXIST, the caller reads a lock that is not there, and
	// acquires on a `stale` claim rather than a `clean` one: a recovery skipped
	// that could have been done, which is the safe direction to be wrong in.
	const pending = `${lockPath}.${process.pid}.pending.lock`;

	try {
		fs.writeFileSync(pending, JSON.stringify(holder));
		fs.linkSync(pending, lockPath);
		return true;
	} catch {
		return false;
	} finally {
		try {
			fs.rmSync(pending, {force: true});
		} catch {
			// The link either happened or it did not; this is only tidying.
		}
	}
};

/**
 * Takes the lock, or reports who holds it. Never waits: a caller that cannot
 * have the worktree wants to say so and move on, not to queue behind a sync
 * that may be stuck on an unreachable remote.
 */
export const acquireSyncLock = async ({
	worktreeRoot,
	operation,
}: {
	worktreeRoot: string;
	operation: string;
}): Promise<Result<LockOutcome>> => {
	// The gitdir, never the worktree tree: nothing here may ever become
	// committable, and `.epiq/` is staged by glob.
	const gitDirResult = await getGitDir(worktreeRoot);
	if (isFail(gitDirResult)) return failed(gitDirResult.message);

	const lockPath = path.join(gitDirResult.value, SYNC_LOCK_FILE);

	const release = () => {
		try {
			// Only ours: a lock we broke and then lost a race for belongs to
			// whoever wrote it after us.
			const current = readHolder(lockPath);
			if (current && current.pid === process.pid) fs.rmSync(lockPath);
		} catch {
			// Releasing is best-effort. A lock left behind is recovered by the
			// liveness check on the next attempt, which is exactly its job.
		}
	};

	if (write(lockPath, operation)) {
		return succeeded('Acquired sync lock', {
			acquired: true,
			claim: 'clean',
			release,
		});
	}

	const holder = readHolder(lockPath);
	const claim = claimOver(holder);

	if (claim === null) {
		return succeeded('Sync lock is held', {
			acquired: false,
			heldBy: holder as LockHolder,
		});
	}

	logger.info(
		`Breaking an abandoned sync lock: ${
			holder ? describeHolder(holder) : 'unreadable lock file'
		}`,
	);

	try {
		fs.rmSync(lockPath, {force: true});
	} catch {
		// Someone else broke it first; the retry below settles who wins.
	}

	if (write(lockPath, operation)) {
		return succeeded('Acquired sync lock after breaking a stale one', {
			acquired: true,
			claim,
			release,
		});
	}

	// Lost the race to whoever else was breaking the same stale lock. They hold
	// it legitimately now, so this is a refusal, not an error.
	const winner = readHolder(lockPath);

	return succeeded('Sync lock taken by another process', {
		acquired: false,
		heldBy: winner ?? {
			pid: -1,
			hostname: os.hostname(),
			startedAt: Date.now(),
			operation: 'unknown',
		},
	});
};

/** Runs `fn` holding the lock, or returns null if somebody else has it. */
export const withSyncLock = async <T>({
	worktreeRoot,
	operation,
	fn,
}: {
	worktreeRoot: string;
	operation: string;
	fn: (claim: LockClaim) => Promise<T>;
}): Promise<Result<T | null>> => {
	const lockResult = await acquireSyncLock({worktreeRoot, operation});
	if (isFail(lockResult)) return failed(lockResult.message);

	if (!lockResult.value.acquired) {
		logger.info(
			`Skipping ${operation}: the state worktree is held by ${describeHolder(
				lockResult.value.heldBy,
			)}`,
		);

		return succeeded('State worktree is held by another process', null);
	}

	const {claim, release} = lockResult.value;

	try {
		return succeeded('Ran under the sync lock', await fn(claim));
	} finally {
		release();
	}
};
