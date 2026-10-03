import fs from 'node:fs';
import path from 'node:path';
import {execGit} from '../../git/git-utils.js';
import {acquireLockFile} from '../../git/sync-lock.js';
import {logger} from '../../logger.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {invalidateCommitTimelineCache} from './commit-timeline.js';
import {
	CLONE_DIR_NAME,
	CommitRepo,
	getRepoClonePath,
	getRepoClonesDir,
	readCommitRepos,
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
		fs.writeFileSync(statusPath(clonePath), JSON.stringify(status) + '\n');
	} catch (error) {
		logger.info(`[repos] could not record fetch status: ${String(error)}`);
	}
};

export type RepoState = CommitRepo & {
	/** Whether a clone exists on this machine yet. */
	cloned: boolean;
	fetchedAt: number | null;
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
			const cloned = fs.existsSync(clonePath);
			const status = readStatus(clonePath);

			return {
				...repo,
				cloned,
				fetchedAt: status?.fetchedAt ?? null,
				error: status?.error ?? null,
			};
		}),
	);
};

const git = (cwd: string, args: string[]) =>
	execGit({cwd, args, timeoutMs: TRANSFER_TIMEOUT_MS});

const defaultBranchOf = async (clonePath: string): Promise<string | null> => {
	const result = await execGit({
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

	const refsResult = await execGit({
		cwd: clonePath,
		args: ['for-each-ref', '--format=%(refname)', 'refs/heads/'],
	});
	if (isFail(refsResult)) return;

	for (const ref of refsResult.value.stdout.split('\n').filter(Boolean)) {
		if (ref === `refs/heads/${name}`) continue;
		await execGit({cwd: clonePath, args: ['update-ref', '-d', ref]});
	}
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
 * window, where the boundary is a commit nobody asked to see.
 */
const deepenPastWindow = (clonePath: string) =>
	git(clonePath, ['fetch', '--no-tags', '--deepen=1', 'origin']);

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

	await execGit({
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

		const configResult = await execGit({
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

	const fetchResult = await git(clonePath, [
		'fetch',
		'--prune',
		'--no-tags',
		...window,
		'origin',
	]);
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
	/** Whether the clone's branches moved, so its commits may have. */
	changed: boolean;
	/** Why it failed, or that another process had the clone. */
	message: string;
};

/**
 * What the clone's branches point at, and where its history is cut: a fetch
 * that moved either moved the commits it holds. Widening the window moves no
 * branch at all.
 */
const refsOf = async (clonePath: string): Promise<string> => {
	if (!fs.existsSync(clonePath)) return '';

	const result = await execGit({
		cwd: clonePath,
		args: ['for-each-ref', '--format=%(objectname) %(refname)'],
	});

	const shallow = isShallow(clonePath)
		? fs.readFileSync(path.join(clonePath, 'shallow'), 'utf8')
		: '';

	return `${isFail(result) ? '' : result.value.stdout}\n${shallow}`;
};

const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const LOCK_SUFFIX = '.lock';

const fetchOne = async (
	projectId: string,
	boardCreatedAt: string,
	repo: CommitRepo,
	minIntervalMs: number,
): Promise<RepoFetchOutcome> => {
	const outcome = (ok: boolean, message: string, changed = false) => ({
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
	} catch (error) {
		return outcome(false, errorMessage(error));
	}

	const lock = acquireLockFile({
		lockPath: `${clonePath}${LOCK_SUFFIX}`,
		operation: `fetch ${repo.label}`,
		// A clone may run that long; breaking it sooner would start a second.
		staleAfterMs: TRANSFER_TIMEOUT_MS * 2,
	});

	if (!lock.acquired) return outcome(true, 'Another process is fetching it');

	try {
		const cloned = fs.existsSync(clonePath);
		// Read even with no clone: a first clone that failed left one.
		const previous = readStatus(clonePath);

		// Autosync asks often; a repo tried a moment ago, with the same options,
		// is left alone — one that failed too, or an unreachable host is asked
		// again every few seconds. A sync somebody asked for passes no interval.
		if (
			previous?.attemptedAt &&
			previous.branches === repo.branches &&
			previous.since === since &&
			Date.now() - previous.attemptedAt < minIntervalMs
		) {
			return previous.error
				? outcome(false, previous.error)
				: outcome(true, 'Fetched recently');
		}

		const before = await refsOf(clonePath);
		const result = cloned
			? await fetchRepo(clonePath, repo, since, cloned ? previous : null)
			: await cloneRepo(clonePath, repo, since);
		const message = isFail(result) ? result.message.trim() : 'Fetched';

		// Written whether or not a clone exists: a first clone that failed has
		// nothing else to say why.
		writeStatus(clonePath, {
			fetchedAt: isFail(result) ? previous?.fetchedAt ?? null : Date.now(),
			attemptedAt: Date.now(),
			error: isFail(result) ? message : null,
			branches: isFail(result)
				? previous?.branches ?? repo.branches
				: repo.branches,
			since: isFail(result) ? previous?.since ?? since : since,
		});

		if (isFail(result)) {
			logger.info(`[repos] ${repo.label}: ${message}`);
			return outcome(false, message);
		}

		return outcome(true, message, (await refsOf(clonePath)) !== before);
	} catch (error) {
		// A filesystem refusal is this repo's failure, never the process's: the
		// GUI starts this without awaiting it.
		logger.info(`[repos] ${repo.label}: ${errorMessage(error)}`);
		return outcome(false, errorMessage(error));
	} finally {
		lock.release();
	}
};

/**
 * Clones that never finished, whose process is gone. A clone of a repo that is
 * no longer listed is left alone: another worktree's branch may still list it,
 * and only an explicit remove deletes one.
 */
const sweepPending = (projectId: string) => {
	const dir = getRepoClonesDir(projectId);
	if (!fs.existsSync(dir)) return;

	for (const name of fs.readdirSync(dir)) {
		const pending = /^.+\.git\.(\d+)\.pending$/.exec(name);
		if (pending && !isAlive(Number(pending[1]))) {
			fs.rmSync(path.join(dir, name), {recursive: true, force: true});
		}
	}
};

/** Deletes this machine's clone of a repo, once it has been unregistered. */
export const removeRepoClone = (input: {
	repoRoot: string;
	repoId: string;
}): Result<null> => {
	const projectResult = readRepoProject(input.repoRoot);
	if (isFail(projectResult)) return failed(projectResult.message);

	const clonePath = getRepoClonePath(
		projectResult.value.projectId,
		input.repoId,
	);
	if (!CLONE_DIR_NAME.test(path.basename(clonePath))) {
		return failed('Not a clone epiq made');
	}

	const lock = acquireLockFile({
		lockPath: `${clonePath}${LOCK_SUFFIX}`,
		operation: 'remove',
		staleAfterMs: TRANSFER_TIMEOUT_MS * 2,
	});
	if (!lock.acquired) return failed('Another process is fetching it');

	try {
		fs.rmSync(clonePath, {recursive: true, force: true});
		fs.rmSync(statusPath(clonePath), {force: true});
	} catch (error) {
		return failed(`Could not remove the clone: ${String(error)}`);
	} finally {
		lock.release();
	}

	return succeeded('Removed clone', null);
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

	// A repo removed while its fetch ran could not have its clone deleted then
	// — the fetch held it — so it goes now, rather than staying for good.
	const stillListed = readCommitRepos(repoRoot);
	if (!isFail(stillListed)) {
		const listed = new Set(stillListed.value.map(repo => repo.id));
		for (const repo of repos) {
			if (!listed.has(repo.id)) removeRepoClone({repoRoot, repoId: repo.id});
		}
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
		.map(outcome => outcome.label)
		.join(', ')}`;
};
