import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {getGitDir} from './git-utils.js';
import {logger} from '../logger.js';

/**
 * An advisory cross-process lock over the state branch worktree, so one process
 * never aborts another's live rebase. Binds epiq processes only, and assumes a
 * local filesystem; a lock from another host is never broken on liveness.
 */

/** Shared by every build: never rename it, and sweeps must leave it alone. */
export const SYNC_LOCK_FILE = 'epiq-sync.lock';

/** Backstop for a recycled pid; generous, since breaking a live lock is worse. */
const STALE_AFTER_MS = 10 * 60 * 1000;

type LockHolder = {
	pid: number;
	hostname: string;
	startedAt: number;
	operation: string;
	/** Tells two holds by one process apart. Absent from older builds' locks. */
	token?: string;
	/** Guards against pid reuse. Absent from older builds' locks. */
	processStartedAt?: number;
};

const PROCESS_STARTED_AT = Date.now() - process.uptime() * 1000;

/** When this process started, as `pidStartedAfter` reads a pid's start back. */
export const processStartedAt = (): number => Math.round(PROCESS_STARTED_AT);

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

/**
 * Whether the process running as `pid` started after `atMs`: then it is not the
 * one that wrote something at that time, whose pid it was given.
 */
export const pidStartedAfter = (pid: number, atMs: number): boolean => {
	const startedAt = startTimeOf(pid);
	return startedAt !== null && startedAt > atMs + START_TOLERANCE_MS;
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
 * How the lock became ours. `stale` was broken on age alone, its holder maybe
 * still running, so the caller must not touch that holder's work.
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

/** `kill(pid, 0)` only probes; `EPERM` means alive, under another user. */
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
	// An unreadable lock is broken but proves nobody gone: `stale`, so nothing is unwound.
	if (!holder) return 'stale';

	// Another machine's pid is not ours to interpret, so only age can settle it.
	if (holder.hostname !== os.hostname()) {
		return Date.now() - holder.startedAt > staleAfterMs ? 'stale' : null;
	}

	if (!isProcessAlive(holder.pid)) return 'dead';
	if (checkProcess && !isSameProcess(holder)) return 'dead';

	return Date.now() - holder.startedAt > staleAfterMs ? 'stale' : null;
};

/** Whether a live process holds the worktree; a breakable lock counts as free. */
export const isSyncLockHeld = (gitDir: string): boolean => {
	const lockPath = path.join(gitDir, SYNC_LOCK_FILE);
	if (!fs.existsSync(lockPath)) return false;

	return claimOver(readHolder(lockPath)) === null;
};

// Cached, since a worktree's gitdir doesn't move; only answers, as it may not exist yet.
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
 * Writes the holder to a temp file, then `link`s it into place: one atomic step
 * that fails if the lock exists, so nobody ever sees it empty.
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

	// Ends in `.lock`, so the stale-lock sweep collects one a killed process leaves.
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

/** Takes the lock, or reports who holds it. Never waits. */
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
	 * Also counts as dead a lock whose pid now runs another process, or that
	 * predates the last boot. For linked repos' locks only.
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

		// May be mid-handover: only a lock that stays unreadable is broken.
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

		// Moved aside, then checked it is the lock that was judged, not a fresh one.
		const aside = `${lockPath}.${process.pid}.${randomUUID()}.broken.lock`;
		try {
			fs.renameSync(lockPath, aside);
		} catch {
			continue;
		}

		if (!sameHolder(readHolder(aside), holder)) {
			// A live lock taken by mistake goes back, unless the slot was refilled.
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
