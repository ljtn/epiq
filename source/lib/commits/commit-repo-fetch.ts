import fs from 'node:fs';
import path from 'node:path';
import {execGit} from '../../git/git-utils.js';
import {acquireLockFile} from '../../git/sync-lock.js';
import {logger} from '../../logger.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {invalidateCommitTimelineCache} from './commit-timeline.js';
import {cloneReadProblem} from './commit-sources.js';
import {
	CLONE_DIR_NAME,
	CommitRepo,
	getRepoClonePath,
	getRepoClonesDir,
	readCommitRepos,
	repoIdOf,
	readRepoProject,
	RepoBranches,
	sinceDate,
} from './commit-repos.js';

// epiq's own bare clones of the other repos: made and fetched on sync only,
// never on boot or on a read. Everything after the clone is a read.

/** A transfer whose size nobody knows in advance; long, but not forever. */
const TRANSFER_TIMEOUT_MS = 30 * 60 * 1000;

// Beside the clone rather than in it, so a first clone that fails — and
// leaves no clone — still records why.
const statusPath = (clonePath: string) => `${clonePath}.json`;

// Left by a remove that found the clone in use; the fetch holding it deletes
// it on the way out. Only an explicit remove deletes a clone: another worktree
// may still list a repo this one does not.
const removalMark = (clonePath: string) => `${clonePath}.removed`;

/** What the clone was last fetched with, and how that went. */
export type RepoFetchStatus = {
	fetchedAt: number | null;
	/** The last try, landed or not: what autosync's interval counts from. */
	attemptedAt: number | null;
	error: string | null;
	branches: RepoBranches | null;
	/** The date history starts at, or null for all of it. */
	since: string | null;
};

const readStatus = (clonePath: string): RepoFetchStatus | null => {
	try {
		const raw = JSON.parse(
			fs.readFileSync(statusPath(clonePath), 'utf8'),
		) as Partial<RepoFetchStatus>;

		return {
			fetchedAt: typeof raw.fetchedAt === 'number' ? raw.fetchedAt : null,
			attemptedAt: typeof raw.attemptedAt === 'number' ? raw.attemptedAt : null,
			error: typeof raw.error === 'string' ? raw.error : null,
			branches:
				raw.branches === 'all' || raw.branches === 'default'
					? raw.branches
					: null,
			since: typeof raw.since === 'string' ? raw.since : null,
		};
	} catch {
		return null;
	}
};

const writeStatus = (clonePath: string, status: RepoFetchStatus) => {
	try {
		// Renamed into place: another process reads it without the clone's lock.
		const pending = `${statusPath(clonePath)}.${process.pid}.tmp`;
		fs.writeFileSync(pending, JSON.stringify(status) + '\n');
		fs.renameSync(pending, statusPath(clonePath));
	} catch (error) {
		logger.info(`[repos] could not record fetch status: ${String(error)}`);
	}
};

export type RepoState = CommitRepo & {
	/** Whether a clone exists on this machine yet. */
	cloned: boolean;
	fetchedAt: number | null;
	/** Why the last fetch failed, or why the clone could not be read. */
	error: string | null;
};

/** The registered repos and how each one's clone stands, without a network call. */
export const listRepoStates = (repoRoot: string): Result<RepoState[]> => {
	const projectResult = readRepoProject(repoRoot);
	if (isFail(projectResult)) return failed(projectResult.message);

	const reposResult = readCommitRepos(repoRoot);
	if (isFail(reposResult)) return failed(reposResult.message);

	return succeeded(
		'Listed repos',
		reposResult.value.map(repo => {
			const clonePath = getRepoClonePath(
				projectResult.value.projectId,
				repo.id,
			);
			const status = readStatus(clonePath);

			return {
				...repo,
				cloned: fs.existsSync(clonePath),
				fetchedAt: status?.fetchedAt ?? null,
				error: status?.error ?? cloneReadProblem(repo.id),
			};
		}),
	);
};

const localGit = (input: {cwd: string; args: string[]; timeoutMs?: number}) =>
	execGit({...input, forClone: true});

const git = (cwd: string, args: string[]) =>
	localGit({cwd, args, timeoutMs: TRANSFER_TIMEOUT_MS});

/**
 * What a failed git call says to a person: git's own last `fatal:` or `error:`
 * line, not the argv `execGit` leads with. Whatever the remote said is in it,
 * so it is kept as plain text, and short.
 */
const gitReason = (message: string): string => {
	const lines = message
		.split('\n')
		.map(line => line.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '').trim())
		.filter(line => line && !line.startsWith('git '));
	const said = lines.filter(line => /^(fatal|error):/i.test(line));
	const reason = said[said.length - 1] ?? lines[lines.length - 1] ?? message;

	return reason.replace(/^(fatal|error):\s*/i, '').slice(0, 300);
};

const defaultBranchOf = async (clonePath: string): Promise<string | null> => {
	const result = await localGit({
		cwd: clonePath,
		args: ['symbolic-ref', '--short', 'HEAD'],
	});

	return isFail(result) ? null : result.value.stdout.trim() || null;
};

const refspecFor = async (
	clonePath: string,
	branches: RepoBranches,
): Promise<Result<string>> => {
	if (branches === 'all') {
		return succeeded('All branches', '+refs/heads/*:refs/heads/*');
	}

	const name = await defaultBranchOf(clonePath);
	if (!name) return failed('Could not tell which branch is the default');

	return succeeded('Default branch', `+refs/heads/${name}:refs/heads/${name}`);
};

/** Leaves only the default branch, after a switch from all of them. */
const dropOtherBranches = async (clonePath: string): Promise<void> => {
	const name = await defaultBranchOf(clonePath);
	if (!name) return;

	const refsResult = await localGit({
		cwd: clonePath,
		args: ['for-each-ref', '--format=%(refname)', 'refs/heads/'],
	});
	if (isFail(refsResult)) return;

	for (const ref of refsResult.value.stdout.split('\n').filter(Boolean)) {
		if (ref === `refs/heads/${name}`) continue;
		await localGit({cwd: clonePath, args: ['update-ref', '-d', ref]});
	}
};

/** Whether the clone holds any commits at all; an empty repository has none. */
const hasRefs = async (clonePath: string): Promise<boolean> => {
	const result = await localGit({
		cwd: clonePath,
		args: ['for-each-ref', '--count=1', '--format=x', 'refs/heads/'],
	});

	return !isFail(result) && result.value.stdout.trim() !== '';
};

/**
 * The window as git reads it: UTC midnight of the day, as an epoch. A bare
 * date is taken at the local time of day, which moves the cut with the hour
 * the clone happened to run at.
 */
const shallowSince = (since: string) =>
	`--shallow-since=@${Math.floor(Date.parse(`${since}T00:00:00Z`) / 1000)}`;

/**
 * `--shallow-since` cuts *at* the oldest commit in the window: that commit is
 * kept without its parent, so it would be left out as a boundary and its diff
 * could not be read. One commit deeper moves the cut to just outside the
 * window. Nothing to deepen in a repository with no commits yet.
 */
const deepenPastWindow = async (clonePath: string): Promise<Result<null>> => {
	if (!(await hasRefs(clonePath))) return succeeded('Empty', null);

	const result = await git(clonePath, [
		'fetch',
		'--no-tags',
		'--deepen=1',
		'origin',
	]);
	return isFail(result) ? failed(result.message) : succeeded('Deepened', null);
};

// A window with no commits in it is not an error worth failing a clone over:
// git refuses `--shallow-since` when it selects nothing, and one commit is
// the smallest history there is. That commit is a shallow boundary, which the
// timeline leaves out, so the repo simply shows nothing yet.
const NOTHING_SELECTED =
	/no commits selected for shallow requests|error processing shallow info/i;

const cloneRepo = async (
	clonePath: string,
	repo: CommitRepo,
	since: string | null,
): Promise<Result<null>> => {
	const clonesDir = path.dirname(clonePath);
	fs.mkdirSync(clonesDir, {recursive: true});

	// Cloned beside its final name and moved into place, so a clone cut short
	// never looks like one that finished.
	const pending = `${clonePath}.${process.pid}.pending`;
	fs.rmSync(pending, {recursive: true, force: true});

	const args = (window: string[]) => [
		'clone',
		'--bare',
		'--no-tags',
		// Explicit both ways: a window implies --single-branch otherwise.
		repo.branches === 'default' ? '--single-branch' : '--no-single-branch',
		...window,
		'--',
		repo.url,
		pending,
	];

	let cloneResult = await git(
		clonesDir,
		args(since ? [shallowSince(since)] : []),
	);
	let windowed = since !== null;

	if (
		isFail(cloneResult) &&
		since &&
		NOTHING_SELECTED.test(cloneResult.message)
	) {
		fs.rmSync(pending, {recursive: true, force: true});
		cloneResult = await git(clonesDir, args(['--depth=1']));
		windowed = false;
	}

	if (isFail(cloneResult)) {
		fs.rmSync(pending, {recursive: true, force: true});
		return failed(cloneResult.message);
	}

	// A bare clone records no fetch refspec, so a later fetch would reach only
	// the remote's HEAD.
	const refspecResult = await refspecFor(pending, repo.branches);
	if (isFail(refspecResult)) {
		fs.rmSync(pending, {recursive: true, force: true});
		return failed(refspecResult.message);
	}

	await localGit({
		cwd: pending,
		args: ['config', 'remote.origin.fetch', refspecResult.value],
	});

	if (windowed) {
		const deepenResult = await deepenPastWindow(pending);
		if (isFail(deepenResult)) {
			fs.rmSync(pending, {recursive: true, force: true});
			return failed(deepenResult.message);
		}
	}

	// Another process can only have got here first by breaking a lock it took
	// for abandoned; its clone is as good as this one.
	if (fs.existsSync(clonePath)) {
		fs.rmSync(pending, {recursive: true, force: true});
		return succeeded('Cloned elsewhere', null);
	}

	fs.renameSync(pending, clonePath);
	return succeeded('Cloned', null);
};

/** A branch name git accepts, and nothing a refspec would read as a pattern. */
const isBranchName = async (clonePath: string, name: string) =>
	!/[*:]/.test(name) &&
	!isFail(
		await localGit({
			cwd: clonePath,
			args: ['check-ref-format', `refs/heads/${name}`],
		}),
	);

/** Points HEAD and the refspec at the branch the remote now calls its default. */
const followDefaultBranch = async (
	clonePath: string,
): Promise<Result<null>> => {
	const remote = await git(clonePath, [
		'ls-remote',
		'--symref',
		'origin',
		'HEAD',
	]);
	if (isFail(remote)) return failed(remote.message);

	const name = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(
		remote.value.stdout,
	)?.[1];
	if (!name || !(await isBranchName(clonePath, name))) {
		return failed('Could not tell which branch the remote now defaults to');
	}

	const headResult = await localGit({
		cwd: clonePath,
		args: ['symbolic-ref', 'HEAD', `refs/heads/${name}`],
	});
	if (isFail(headResult)) return failed(headResult.message);

	const configResult = await localGit({
		cwd: clonePath,
		args: [
			'config',
			'remote.origin.fetch',
			`+refs/heads/${name}:refs/heads/${name}`,
		],
	});
	return isFail(configResult)
		? failed(configResult.message)
		: succeeded('Followed', null);
};

/**
 * Git's own lock files that a git process left behind. Only epiq runs git in
 * its clones, only while holding the clone's lock, and it kills its git when
 * it exits — so any found here belong to a git that is gone. Left, every
 * fetch after fails on them for good.
 */
const clearStaleGitLocks = (clonePath: string) => {
	const visit = (dir: string, depth: number) => {
		for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
			const full = path.join(dir, entry.name);

			if (entry.isFile() && entry.name.endsWith('.lock')) {
				fs.rmSync(full, {force: true});
			} else if (entry.isDirectory() && depth > 0) {
				visit(full, depth - 1);
			}
		}
	};

	try {
		// The top (HEAD, config, shallow, packed-refs) and the ref tree, which
		// is as deep as a branch name has slashes.
		for (const name of fs.readdirSync(clonePath)) {
			if (name.endsWith('.lock')) {
				fs.rmSync(path.join(clonePath, name), {force: true});
			}
		}
		const refs = path.join(clonePath, 'refs');
		if (fs.existsSync(refs)) visit(refs, 16);
	} catch (error) {
		logger.info(`[repos] could not clear stale locks: ${String(error)}`);
	}
};

const isShallow = (clonePath: string) =>
	fs.existsSync(path.join(clonePath, 'shallow'));

const fetchRepo = async (
	clonePath: string,
	repo: CommitRepo,
	since: string | null,
	previous: RepoFetchStatus | null,
): Promise<Result<null>> => {
	const branchesChanged = previous?.branches !== repo.branches;

	if (branchesChanged) {
		const refspecResult = await refspecFor(clonePath, repo.branches);
		if (isFail(refspecResult)) return failed(refspecResult.message);

		const configResult = await localGit({
			cwd: clonePath,
			args: ['config', 'remote.origin.fetch', refspecResult.value],
		});
		if (isFail(configResult)) return failed(configResult.message);
	}

	// Widening the window is a fetch; narrowing it would mean a fresh clone,
	// and the older commits it would drop do no harm while they stay.
	const window =
		since === null
			? isShallow(clonePath)
				? ['--unshallow']
				: []
			: previous?.since && since < previous.since
			? [shallowSince(since)]
			: [];

	const fetchArgs = ['fetch', '--prune', '--no-tags', ...window, 'origin'];
	let fetchResult = await git(clonePath, fetchArgs);

	// The remote renamed its default branch: the refspec still names the old
	// one, and would go on failing for good.
	if (
		isFail(fetchResult) &&
		repo.branches === 'default' &&
		/couldn't find remote ref/i.test(fetchResult.message)
	) {
		const followed = await followDefaultBranch(clonePath);
		if (isFail(followed)) return failed(followed.message);

		fetchResult = await git(clonePath, fetchArgs);
		if (!isFail(fetchResult)) await dropOtherBranches(clonePath);
	}
	if (isFail(fetchResult)) return failed(fetchResult.message);

	if (window[0]?.startsWith('--shallow-since')) {
		const deepenResult = await deepenPastWindow(clonePath);
		if (isFail(deepenResult)) return failed(deepenResult.message);
	}

	if (branchesChanged && repo.branches === 'default') {
		await dropOtherBranches(clonePath);
	}

	return succeeded('Fetched', null);
};

export type RepoFetchOutcome = {
	id: string;
	label: string;
	ok: boolean;
	/** Whether the clone's commits moved since this process last looked. */
	changed: boolean;
	/** Not fetched now: another process has the clone, and it was asked for. */
	skipped?: boolean;
	/** Why it failed, or why it was skipped. */
	message: string;
};

/**
 * What the clone's branches point at, and where its history is cut: a fetch
 * that moved either moved the commits it holds. Widening the window moves no
 * branch at all.
 */
const refsOf = async (clonePath: string): Promise<string> => {
	if (!fs.existsSync(clonePath)) return '';

	const result = await localGit({
		cwd: clonePath,
		args: ['for-each-ref', '--format=%(objectname) %(refname)'],
	});

	const shallow = isShallow(clonePath)
		? fs.readFileSync(path.join(clonePath, 'shallow'), 'utf8')
		: '';

	return `${isFail(result) ? '' : result.value.stdout}\n${shallow}`;
};

// What each clone held when this process last looked. Another process's fetch
// moves a clone too, and only a comparison with what was seen here, rather
// than with the moment before this process's own fetch, tells its clients so.
const lastSeen = new Map<string, string>();

const movedSinceSeen = (clonePath: string, refs: string): boolean => {
	const seen = lastSeen.get(clonePath);
	lastSeen.set(clonePath, refs);

	return seen !== undefined && seen !== refs;
};

/**
 * Whether the clone came from this repo, spelling aside — or unknown, when its
 * config cannot be read. Only a clone known to name another repo is replaced.
 */
const originOf = async (
	clonePath: string,
	repo: CommitRepo,
): Promise<'this' | 'other' | 'unknown'> => {
	const result = await localGit({
		cwd: clonePath,
		args: ['config', '--get', 'remote.origin.url'],
	});
	if (isFail(result)) return 'unknown';

	return repoIdOf(result.value.stdout.trim()) === repo.id ? 'this' : 'other';
};

/**
 * `EPIQ_GLOBAL_DIR` can point anywhere, a repository included; there the
 * clones would show as untracked files, one `git add -A` from being committed.
 */
const ignoreClonesDir = (dir: string) => {
	const ignore = path.join(dir, '.gitignore');
	if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n');
};

const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const LOCK_SUFFIX = '.lock';

/** Longer than a clone's few transfers: breaking it sooner starts a second. */
const CLONE_LOCK_STALE_MS = TRANSFER_TIMEOUT_MS * 4;

const takeCloneLock = async (
	clonePath: string,
	operation: string,
	waitMs: number,
) => {
	const deadline = Date.now() + waitMs;

	while (true) {
		const lock = acquireLockFile({
			lockPath: `${clonePath}${LOCK_SUFFIX}`,
			operation,
			staleAfterMs: CLONE_LOCK_STALE_MS,
		});
		if (lock.acquired || Date.now() >= deadline) return lock;

		await new Promise(resolve => setTimeout(resolve, 250));
	}
};

/** The clone and its status, gone. Called holding the clone's lock. */
const deleteClone = (clonePath: string) => {
	fs.rmSync(clonePath, {recursive: true, force: true});
	fs.rmSync(statusPath(clonePath), {force: true});
	fs.rmSync(removalMark(clonePath), {force: true});
	lastSeen.delete(clonePath);
};

// How long an explicit fetch waits for another process to let go of a clone.
// Its pass is usually a moment's check; a real fetch outlasts this, and is
// reported as one rather than as a fetch that happened here.
const EXPLICIT_LOCK_WAIT_MS = 5_000;

const fetchOne = async (
	projectId: string,
	boardCreatedAt: string,
	repo: CommitRepo,
	minIntervalMs: number,
): Promise<RepoFetchOutcome> => {
	const outcome = (
		ok: boolean,
		message: string,
		changed = false,
	): RepoFetchOutcome => ({
		id: repo.id,
		label: repo.label,
		ok,
		changed,
		message,
	});

	const clonePath = getRepoClonePath(projectId, repo.id);
	const since = sinceDate(repo.since, boardCreatedAt);

	try {
		fs.mkdirSync(path.dirname(clonePath), {recursive: true});
		ignoreClonesDir(path.dirname(clonePath));
	} catch (error) {
		return outcome(false, errorMessage(error));
	}

	// Decided before the lock: autosync asks every few seconds in every
	// process, and a check that took the lock each time would turn away a fetch
	// somebody asked for. A repo tried a moment ago with the same options is
	// left alone, one that failed too; a sync somebody asked for passes no
	// interval. A clock set back would otherwise hold every fetch off.
	const previous = readStatus(clonePath);
	if (
		previous?.attemptedAt &&
		previous.branches === repo.branches &&
		previous.since === since &&
		Date.now() >= previous.attemptedAt &&
		Date.now() - previous.attemptedAt < minIntervalMs &&
		!fs.existsSync(removalMark(clonePath))
	) {
		const moved =
			fs.existsSync(clonePath) &&
			movedSinceSeen(clonePath, await refsOf(clonePath));

		return previous.error
			? outcome(false, previous.error, moved)
			: outcome(true, 'Fetched recently', moved);
	}

	const lock = await takeCloneLock(
		clonePath,
		`fetch ${repo.label}`,
		minIntervalMs === 0 ? EXPLICIT_LOCK_WAIT_MS : 0,
	);

	if (!lock.acquired) {
		return {
			...outcome(true, 'Being fetched by another process'),
			skipped: true,
		};
	}

	try {
		// A remove that found the clone in use before this fetch began.
		if (fs.existsSync(removalMark(clonePath))) deleteClone(clonePath);

		let cloned = fs.existsSync(clonePath);

		// A clone is fetched from wherever it was cloned from, so one that names
		// another repo is not this one's, and it is started over: it is epiq's
		// own copy. One whose config merely could not be read is left as it is.
		if (cloned && (await originOf(clonePath, repo)) === 'other') {
			deleteClone(clonePath);
			cloned = false;
		}

		const current = cloned ? readStatus(clonePath) : null;

		if (cloned) clearStaleGitLocks(clonePath);

		const result = cloned
			? await fetchRepo(clonePath, repo, since, current)
			: await cloneRepo(clonePath, repo, since);
		const message = isFail(result) ? gitReason(result.message) : 'Fetched';

		// Written whether or not a clone exists: a first clone that failed has
		// nothing else to say why.
		writeStatus(clonePath, {
			fetchedAt: isFail(result) ? current?.fetchedAt ?? null : Date.now(),
			attemptedAt: Date.now(),
			error: isFail(result) ? message : null,
			branches: isFail(result)
				? current?.branches ?? repo.branches
				: repo.branches,
			since: isFail(result) ? current?.since ?? since : since,
		});

		if (isFail(result)) {
			logger.info(`[repos] ${repo.label}: ${result.message}`);
			return outcome(false, message);
		}

		return outcome(
			true,
			message,
			movedSinceSeen(clonePath, await refsOf(clonePath)) || !cloned,
		);
	} catch (error) {
		// A filesystem refusal is this repo's failure, never the process's: the
		// GUI starts this without awaiting it.
		logger.info(`[repos] ${repo.label}: ${errorMessage(error)}`);
		return outcome(false, errorMessage(error));
	} finally {
		// Removed while this fetch held it: it goes now, rather than staying.
		if (fs.existsSync(removalMark(clonePath))) deleteClone(clonePath);
		lock.release();
	}
};

/**
 * Clones and status files a process died writing. A clone of a repo that is
 * no longer listed is left alone: another worktree's branch may still list it,
 * and only an explicit remove deletes one.
 */
const sweepPending = (projectId: string) => {
	const dir = getRepoClonesDir(projectId);
	if (!fs.existsSync(dir)) return;

	for (const name of fs.readdirSync(dir)) {
		const pending = /^.+\.git(?:\.json)?\.(\d+)\.(?:pending|tmp)$/.exec(name);
		if (pending && !isAlive(Number(pending[1]))) {
			fs.rmSync(path.join(dir, name), {recursive: true, force: true});
		}
	}
};

/**
 * Deletes this machine's clone of a repo, once it has been unregistered. A
 * clone a fetch is using is marked instead, and that fetch deletes it.
 */
export const removeRepoClone = (input: {
	repoRoot: string;
	repoId: string;
}): Result<null> => {
	const projectResult = readRepoProject(input.repoRoot);
	if (isFail(projectResult)) return failed(projectResult.message);

	// The id itself, so nothing outside the clones dir can be named.
	if (!CLONE_DIR_NAME.test(`${input.repoId}.git`)) {
		return failed('Not a clone epiq made');
	}

	const clonePath = getRepoClonePath(
		projectResult.value.projectId,
		input.repoId,
	);

	const lock = acquireLockFile({
		lockPath: `${clonePath}${LOCK_SUFFIX}`,
		operation: 'remove',
		staleAfterMs: CLONE_LOCK_STALE_MS,
	});

	try {
		if (!lock.acquired) {
			fs.writeFileSync(removalMark(clonePath), '');
			return succeeded('Removed once its fetch ends', null);
		}

		deleteClone(clonePath);
		return succeeded('Removed clone', null);
	} catch (error) {
		return failed(`Could not remove the clone: ${String(error)}`);
	} finally {
		if (lock.acquired) lock.release();
	}
};

const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
};

// A handful at a time: each is a network round trip, and a board with many
// repos should not open that many connections at once.
const CONCURRENCY = 4;

/**
 * Clones what is missing and fetches the rest. Never fails as a whole: a repo
 * that cannot be reached is reported in its outcome, and the others carry on.
 *
 * Called by every sync's front door after the board itself has synced, and
 * outside any lock the board holds — a first clone can take minutes.
 */
export const fetchCommitRepos = (input: {
	repoRoot: string;
	/** Leave alone a repo fetched less than this long ago, for autosync. */
	minIntervalMs?: number;
}): Promise<Result<RepoFetchOutcome[]>> => {
	const minIntervalMs = input.minIntervalMs ?? 0;

	// One at a time per project in this process: an autosync pass and a click
	// arriving together share the fetch already under way — unless that one
	// was throttled and this asks for more, which runs once it is done.
	const running = inFlight.get(input.repoRoot);
	if (running) {
		return running.minIntervalMs <= minIntervalMs
			? running.result
			: running.result.then(() => fetchCommitRepos(input));
	}

	const result = fetchAll(input.repoRoot, minIntervalMs)
		.catch(
			(error: unknown): Result<RepoFetchOutcome[]> =>
				failed(errorMessage(error)),
		)
		.finally(() => {
			inFlight.delete(input.repoRoot);
		});
	inFlight.set(input.repoRoot, {result, minIntervalMs});

	return result;
};

const inFlight = new Map<
	string,
	{result: Promise<Result<RepoFetchOutcome[]>>; minIntervalMs: number}
>();

const fetchAll = async (
	repoRoot: string,
	minIntervalMs: number,
): Promise<Result<RepoFetchOutcome[]>> => {
	const projectResult = readRepoProject(repoRoot);
	if (isFail(projectResult)) return failed(projectResult.message);

	const reposResult = readCommitRepos(repoRoot);
	if (isFail(reposResult)) return failed(reposResult.message);

	const {projectId, createdAt} = projectResult.value;
	const repos = reposResult.value;

	if (repos.length === 0) return succeeded('No other repos', []);

	try {
		sweepPending(projectId);
	} catch (error) {
		logger.info(`[repos] sweep failed: ${String(error)}`);
	}

	const outcomes: RepoFetchOutcome[] = [];
	for (let start = 0; start < repos.length; start += CONCURRENCY) {
		outcomes.push(
			...(await Promise.all(
				repos
					.slice(start, start + CONCURRENCY)
					.map(repo => fetchOne(projectId, createdAt, repo, minIntervalMs)),
			)),
		);
	}

	if (outcomes.some(outcome => outcome.changed)) {
		invalidateCommitTimelineCache();
	}

	return succeeded('Fetched other repos', outcomes);
};

/** One line for a sync status, or null when every repo came through. */
export const describeFetchFailures = (
	outcomes: readonly RepoFetchOutcome[],
): string | null => {
	const failedRepos = outcomes.filter(outcome => !outcome.ok);
	if (failedRepos.length === 0) return null;

	return `could not fetch ${failedRepos
		.map(outcome => `${outcome.label} (${outcome.message.slice(0, 80)})`)
		.join(', ')}`;
};
