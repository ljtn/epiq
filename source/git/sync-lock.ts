import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
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
	/**
	 * This hold, as against another by the same process: two can share a pid
	 * and a millisecond. Absent from a lock an older build wrote.
	 */
	token?: string;
	/**
	 * When the holding process started: a pid alone is reused, and a crashed
	 * holder's pid taken by any other process would read as the holder.
	 * Absent from a lock an older build wrote.
	 */
	processStartedAt?: number;
};

const PROCESS_STARTED_AT = Date.now() - process.uptime() * 1000;

// Start times read off the system agree with a process's own to within this:
// `ps` gives whole seconds.
const START_TOLERANCE_MS = 5_000;

const FRESH_LOCK_MS = 5_000;

/** When a pid's current process started, or null where this cannot tell. */
const startTimeOf = (pid: number): number | null => {
	try {
		if (process.platform === 'linux') {
			const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
			// After the command name, which may hold spaces and parentheses.
			const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
			const ticks = Number(fields[19]);
			const btime = /^btime (\d+)$/m.exec(
				fs.readFileSync('/proc/stat', 'utf8'),
			)?.[1];
			// Clock ticks are a hundredth of a second on every Linux node runs on.
			return btime && Number.isFinite(ticks)
				? Number(btime) * 1000 + ticks * 10
				: null;
		}

		if (process.platform === 'win32') return null;

		const cached = psStartTimes.get(pid);
		if (cached && Date.now() - cached.at < PS_CACHE_MS) return cached.value;

		const started = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
			encoding: 'utf8',
			timeout: 2_000,
			stdio: ['ignore', 'pipe', 'ignore'],
			// A date `Date.parse` reads, whatever the user's locale.
			env: {...process.env, LC_ALL: 'C'},
		}).trim();
		const parsed = Date.parse(started);
		const value = Number.isNaN(parsed) ? null : parsed;
		psStartTimes.set(pid, {at: Date.now(), value});
		return value;
	} catch {
		return null;
	}
};

// `ps` is a process of its own, and a watcher asks every second while a sync
// holds the lock; a pid is not reused within a few seconds.
const PS_CACHE_MS = 5_000;
const psStartTimes = new Map<number, {at: number; value: number | null}>();

/**
 * Whether a live pid is still the process that wrote the lock: not one that
 * started after it, nor one from before the machine last booted.
 */
const isSameProcess = (holder: LockHolder): boolean => {
	const bootedAt = Date.now() - os.uptime() * 1000;
	if (holder.startedAt < bootedAt) return false;
	// A lock this fresh is its writer's: reuse needs a crash and a recycled
	// pid first. Asked only past that, so contention never waits on `ps`.
	if (Date.now() - holder.startedAt < FRESH_LOCK_MS) return true;
	if (holder.processStartedAt === undefined) return true;

	const startedAt = startTimeOf(holder.pid);
	return (
		startedAt === null ||
		Math.abs(startedAt - holder.processStartedAt) <= START_TOLERANCE_MS
	);
};

// The holds this process has right now, by lock path. A lock naming this
// process that is not among them is one it let go of and somebody put back.
const heldHere = new Map<string, string>();

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
const claimOver = (
	holder: LockHolder | null,
	staleAfterMs = STALE_AFTER_MS,
	/** Also take a live pid as dead when it no longer runs the holder. */
	checkProcess = false,
): LockClaim | null => {
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
		return Date.now() - holder.startedAt > staleAfterMs ? 'stale' : null;
	}

	if (!isProcessAlive(holder.pid)) return 'dead';
	if (checkProcess && !isSameProcess(holder)) return 'dead';

	return Date.now() - holder.startedAt > staleAfterMs ? 'stale' : null;
};

/**
 * Whether a live process holds the worktree right now, for a reader that must
 * not see the logs while git has them. A lock `acquireSyncLock` would break
 * counts as free.
 */
export const isSyncLockHeld = (gitDir: string): boolean => {
	const lockPath = path.join(gitDir, SYNC_LOCK_FILE);
	if (!fs.existsSync(lockPath)) return false;

	return claimOver(readHolder(lockPath)) === null;
};

// `rev-parse` is a subprocess, too slow to spawn on every watch tick, and a
// worktree's gitdir does not move. Only an answer is kept: the worktree may
// not exist yet.
const gitDirs = new Map<string, Promise<string | null>>();

const cachedGitDir = (worktreeRoot: string): Promise<string | null> => {
	const cached = gitDirs.get(worktreeRoot);
	if (cached) return cached;

	const gitDir = getGitDir(worktreeRoot).then(
		result => (isFail(result) ? null : result.value),
		() => null,
	);
	gitDirs.set(worktreeRoot, gitDir);

	void gitDir.then(value => {
		if (value === null && gitDirs.get(worktreeRoot) === gitDir) {
			gitDirs.delete(worktreeRoot);
		}
	});

	return gitDir;
};

/** `isSyncLockHeld` for a worktree; false when git cannot say where its lock is. */
export const isSyncLockHeldAt = async (
	worktreeRoot: string,
): Promise<boolean> => {
	const gitDir = await cachedGitDir(worktreeRoot);

	return gitDir !== null && isSyncLockHeld(gitDir);
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
const write = (lockPath: string, operation: string): LockHolder | null => {
	const holder: LockHolder = {
		pid: process.pid,
		hostname: os.hostname(),
		startedAt: Date.now(),
		operation,
		token: randomUUID(),
		processStartedAt: PROCESS_STARTED_AT,
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
		return holder;
	} catch {
		return null;
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

	return succeeded(
		'Tried the sync lock',
		acquireLockFile({
			lockPath: path.join(gitDirResult.value, SYNC_LOCK_FILE),
			operation,
		}),
	);
};

/** The same claim over any lock file, for a directory that is not a worktree. */
export const acquireLockFile = ({
	lockPath,
	operation,
	staleAfterMs,
	checkProcess = false,
}: {
	lockPath: string;
	operation: string;
	/** For work allowed to run longer than a sync: never broken before this. */
	staleAfterMs?: number;
	/**
	 * Takes a lock whose live pid now runs another process, or that was written
	 * before the last boot, as dead. For the linked repos' locks; the board's
	 * sync lock keeps judging by the pid alone.
	 */
	checkProcess?: boolean;
}): LockOutcome => {
	let mine: LockHolder | null = null;

	const release = () => {
		try {
			// Only this hold: a lock broken and taken by another since belongs to
			// whoever wrote it.
			const current = readHolder(lockPath);
			if (current && sameHolder(current, mine)) fs.rmSync(lockPath);
		} catch {
			// Releasing is best-effort. A lock left behind is recovered by the
			// liveness check on the next attempt, which is exactly its job.
		} finally {
			if (heldHere.get(lockPath) === mine?.token) heldHere.delete(lockPath);
		}
	};

	const take = (claim: LockClaim): LockOutcome | null => {
		mine = write(lockPath, operation);
		if (!mine) return null;

		heldHere.set(lockPath, mine.token!);
		return {acquired: true, claim, release};
	};

	// A few tries, because a lock can change hands between any two steps here.
	for (let attempt = 0; attempt < 5; attempt++) {
		const clean = take('clean');
		if (clean) return clean;

		let holder = readHolder(lockPath);

		// Missing or unreadable at the read: its holder may have let go and
		// another taken it in between. Read again before calling it broken —
		// only a lock that stays unreadable is.
		if (holder === null) {
			if (!fs.existsSync(lockPath)) continue;
			holder = readHolder(lockPath);
			if (holder !== null) continue;
			if (!fs.existsSync(lockPath)) continue;
		}

		// One naming this process that it does not hold: let go of, then put
		// back by a breaker that judged it live. Nobody else will ever take it.
		const orphanOfOurs =
			holder !== null &&
			holder.pid === process.pid &&
			holder.hostname === os.hostname() &&
			heldHere.get(lockPath) !== holder.token;

		const claim = orphanOfOurs
			? 'dead'
			: claimOver(holder, staleAfterMs, checkProcess);
		if (claim === null) return {acquired: false, heldBy: holder as LockHolder};

		logger.info(
			`Breaking an abandoned sync lock: ${
				holder ? describeHolder(holder) : 'unreadable lock file'
			}`,
		);

		// Broken by moving it aside under a name of our own and checking it is
		// the lock that was judged: a rename takes whatever is there now, and
		// that may be a fresh lock another process wrote since the read.
		const aside = `${lockPath}.${process.pid}.${randomUUID()}.broken.lock`;
		try {
			fs.renameSync(lockPath, aside);
		} catch {
			continue;
		}

		if (!sameHolder(readHolder(aside), holder)) {
			// A live lock, taken by mistake: back where it was, unless the slot
			// has been filled again meanwhile. Should its holder have let go in
			// between, it is now an orphan of that process's, which that
			// process reclaims above.
			try {
				fs.linkSync(aside, lockPath);
			} catch {
				// Filled: the lock now there is the one that counts.
			}
			fs.rmSync(aside, {force: true});
			continue;
		}

		fs.rmSync(aside, {force: true});

		const broken = take(claim);
		if (broken) return broken;
	}

	// Lost every race for it. Whoever holds it now holds it legitimately, so
	// this is a refusal, not an error.
	const winner = readHolder(lockPath);

	return {
		acquired: false,
		heldBy: winner ?? {
			pid: -1,
			hostname: os.hostname(),
			startedAt: Date.now(),
			operation: 'unknown',
		},
	};
};

const sameHolder = (a: LockHolder | null, b: LockHolder | null): boolean =>
	a === null || b === null
		? a === b
		: a.pid === b.pid &&
		  a.hostname === b.hostname &&
		  a.startedAt === b.startedAt &&
		  a.token === b.token;

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
