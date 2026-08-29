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

const LOCK_FILE = 'epiq-sync.lock';

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

export type LockOutcome =
	| {acquired: true; release: () => void}
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

/**
 * A lock nobody is holding any more. Unreadable counts: a truncated or
 * half-written lock file has no holder to protect, and leaving it would wedge
 * the worktree permanently.
 */
const isAbandoned = (holder: LockHolder | null): boolean => {
	if (!holder) return true;

	// Another machine's pid is not ours to interpret, so only age can settle it.
	if (holder.hostname !== os.hostname()) {
		return Date.now() - holder.startedAt > STALE_AFTER_MS;
	}

	if (!isProcessAlive(holder.pid)) return true;

	return Date.now() - holder.startedAt > STALE_AFTER_MS;
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

const write = (lockPath: string, operation: string): boolean => {
	const holder: LockHolder = {
		pid: process.pid,
		hostname: os.hostname(),
		startedAt: Date.now(),
		operation,
	};

	try {
		// `wx` fails when the file exists, which is the whole acquisition: the
		// check and the claim are one syscall, so two processes cannot both win.
		fs.writeFileSync(lockPath, JSON.stringify(holder), {flag: 'wx'});
		return true;
	} catch {
		return false;
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

	const lockPath = path.join(gitDirResult.value, LOCK_FILE);

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
		return succeeded('Acquired sync lock', {acquired: true, release});
	}

	const holder = readHolder(lockPath);

	if (!isAbandoned(holder)) {
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
	fn: () => Promise<T>;
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

	const {release} = lockResult.value;

	try {
		return succeeded('Ran under the sync lock', await fn());
	} finally {
		release();
	}
};
