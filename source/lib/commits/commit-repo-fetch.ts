import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execGit, isShuttingDown} from '../../git/git-utils.js';
import {acquireLockFile} from '../../git/sync-lock.js';
import {logger} from '../../logger.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {invalidateCommitTimelineCache} from './commit-timeline.js';
import {cloneReadProblem} from './commit-sources.js';
import {cloneCapMessage, dirSize, readRepoCloneMaxMb} from './clone-size.js';
import {
	CLONE_DIR_NAME,
	cloneStatusPath as statusPath,
	CommitRepo,
	findConnectedRepo,
	getRepoClonePath,
	getRepoClonesDir,
	readConnectedRepos,
	repoIdOf,
	isRepoListed,
	readRepoProject,
	RepoBranches,
	sinceDate,
	STATE_BRANCH_NAME,
	writeRepoEvent,
} from './commit-repos.js';

// epiq's own bare clones of the other repos: made and fetched on sync only,
// never on boot or on a read. Everything after the clone is a read.

/** A transfer whose size nobody knows in advance; long, but not forever. */
const TRANSFER_TIMEOUT_MS = 30 * 60 * 1000;

// Left by a remove that found the clone in use; the fetch holding it deletes
// it on the way out. A clone goes only for a disconnect read off the log,
// which every worktree of a board shares; never for a repo merely not listed.
const removalMark = (clonePath: string) => `${clonePath}.removed`;

// Made, never written through: a link planted under the name is no mark, and
// one already there is the same mark.
const placeRemovalMark = (clonePath: string) => {
	try {
		fs.writeFileSync(removalMark(clonePath), '', {flag: 'wx'});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
		if (isLink(removalMark(clonePath))) {
			throw new Error('The removal mark is a link, which epiq will not use');
		}
	}
};

/** What the clone was last fetched with, and how that went. */
export type RepoFetchStatus = {
	fetchedAt: number | null;
	/** The last try, landed or not: what autosync's interval counts from. */
	attemptedAt: number | null;
	error: string | null;
	branches: RepoBranches | null;
	/** The date history starts at, or null for all of it. */
	since: string | null;
	/** The clone's own epiq state branch, if its project.json names one. */
	stateBranch: string | null;
	/** When the clone was last started over and the new one landed. */
	restartedAt: number | null;
	/** When a start-over was last tried, landed or not. */
	restartTriedAt: number | null;
	/** Start-overs tried since the clone last fetched as itself. */
	restarts: number;
	/** The clone's size on disk after its last fetch that landed. */
	bytes: number | null;
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
			restartedAt: typeof raw.restartedAt === 'number' ? raw.restartedAt : null,
			restartTriedAt:
				typeof raw.restartTriedAt === 'number' ? raw.restartTriedAt : null,
			restarts:
				typeof raw.restarts === 'number' && raw.restarts >= 0
					? raw.restarts
					: 0,
			bytes: typeof raw.bytes === 'number' && raw.bytes >= 0 ? raw.bytes : null,
			stateBranch:
				typeof raw.stateBranch === 'string' &&
				STATE_BRANCH_NAME.test(raw.stateBranch)
					? raw.stateBranch
					: null,
		};
	} catch {
		return null;
	}
};

const writeStatus = (clonePath: string, status: RepoFetchStatus) => {
	try {
		// Renamed into place: another process reads it without the clone's lock.
		// `wx`: never through a link somebody planted under the name.
		// Random beyond the pid: a dead process's leftover under a pid reused
		// since would otherwise refuse every later write.
		const pending = `${statusPath(clonePath)}.${
			process.pid
		}.${randomUUID()}.tmp`;
		fs.writeFileSync(pending, JSON.stringify(status) + '\n', {flag: 'wx'});
		fs.renameSync(pending, statusPath(clonePath));
	} catch (error) {
		logger.info(`[repos] could not record fetch status: ${String(error)}`);
	}
};

export type RepoState = CommitRepo & {
	/** Whether a clone exists on this machine yet. */
	cloned: boolean;
	/** Connected past the cap: listed, never fetched, until one ahead of it goes. */
	overLimit: boolean;
	/** The clone's size after its last fetch, or null where none has landed. */
	bytes: number | null;
	fetchedAt: number | null;
	/** Why the last fetch failed, or why the clone could not be read. */
	error: string | null;
};

/** The registered repos and how each one's clone stands, without a network call. */
export const listRepoStates = (repoRoot: string): Result<RepoState[]> => {
	const projectResult = readRepoProject(repoRoot);
	if (isFail(projectResult)) return failed(projectResult.message);

	const reposResult = readConnectedRepos(repoRoot);
	if (isFail(reposResult)) return failed(reposResult.message);

	const state = (repo: CommitRepo, overLimit: boolean): RepoState => {
		const clonePath = getRepoClonePath(projectResult.value.projectId, repo.id);
		const status = readStatus(clonePath);
		const cloned = fs.existsSync(clonePath);

		return {
			...repo,
			cloned,
			overLimit,
			bytes: cloned ? status?.bytes ?? null : null,
			fetchedAt: status?.fetchedAt ?? null,
			error: status?.error ?? cloneReadProblem(repo.id),
		};
	};

	return succeeded('Listed repos', [
		...reposResult.value.live.map(repo => state(repo, false)),
		...reposResult.value.overLimit.map(repo => state(repo, true)),
	]);
};

const localGit = (input: {
	cwd: string;
	args: string[];
	timeoutMs?: number;
	abort?: AbortSignal;
}) => execGit({...input, forClone: true});

const git = (cwd: string, args: string[]) =>
	localGit({cwd, args, timeoutMs: TRANSFER_TIMEOUT_MS});

// How often a transfer's directory is measured against the cap.
const SIZE_CHECK_MS = 1_000;

/**
 * A transfer into `into`, held to this machine's cap: a repo listed by
 * somebody else's commit must not fill the disk. Stopped once the directory
 * passes it, and failed if it landed past it anyway — a fast transfer can
 * finish between two looks. Into an existing clone, a transfer that passed
 * the cap is undone: the clone keeps what it held.
 */
const transfer = async (
	cwd: string,
	args: string[],
	into: string,
	/** The clone as it stood before the fetch began, to put back. */
	{undo}: {undo?: CloneSnapshot} = {},
): Promise<Result<unknown>> => {
	const maxMb = readRepoCloneMaxMb();
	const maxBytes = maxMb * 1024 * 1024;
	const controller = new AbortController();
	const watch = setInterval(() => {
		if (dirSize(into) > maxBytes) controller.abort(cloneCapMessage(maxMb));
	}, SIZE_CHECK_MS);

	let result: Result<unknown>;
	try {
		result = await localGit({
			cwd,
			args,
			timeoutMs: TRANSFER_TIMEOUT_MS,
			abort: controller.signal,
		});
	} finally {
		clearInterval(watch);
	}

	const capped =
		controller.signal.aborted || (!isFail(result) && dirSize(into) > maxBytes);
	if (!capped) return result;

	clearTransferLeftovers(into);
	if (undo) {
		restoreSnapshot(into, undo);
		// A git stopped partway leaves its locks; nothing else holds them.
		clearStaleGitLocks(into);
	}
	return failed(cloneCapMessage(maxMb));
};

type CloneSnapshot = {
	refs: Map<string, Buffer>;
	packedRefs: Buffer | null;
	/** The branch followed and the refspec fetching it, which a follow moves. */
	head: Buffer | null;
	config: Buffer | null;
	shallow: Buffer | null;
	packs: ReadonlySet<string>;
};

const readOrNull = (file: string): Buffer | null => {
	try {
		return fs.readFileSync(file);
	} catch {
		return null;
	}
};

const listOr = (dir: string): string[] => {
	try {
		return fs.readdirSync(dir);
	} catch {
		return [];
	}
};

/** What a fetch changes: the refs, the shallow boundary, and the packs. */
const snapshotOf = (clonePath: string): CloneSnapshot => {
	const refs = new Map<string, Buffer>();
	const visit = (relative: string) => {
		const full = path.join(clonePath, relative);
		for (const entry of fs.readdirSync(full, {withFileTypes: true})) {
			const child = path.join(relative, entry.name);
			if (entry.isDirectory()) visit(child);
			else refs.set(child, fs.readFileSync(path.join(clonePath, child)));
		}
	};
	if (fs.existsSync(path.join(clonePath, 'refs'))) visit('refs');

	return {
		refs,
		packedRefs: readOrNull(path.join(clonePath, 'packed-refs')),
		head: readOrNull(path.join(clonePath, 'HEAD')),
		config: readOrNull(path.join(clonePath, 'config')),
		shallow: readOrNull(path.join(clonePath, 'shallow')),
		packs: new Set(listOr(path.join(clonePath, 'objects', 'pack'))),
	};
};

// Restore writes land here first: at the clone's top, where git reads no
// stray file, never beside a ref, where one would be read as a branch.
const RESTORE_TEMP = 'epiq-restore-';

/** A file replaced whole or not at all: a process stopped here leaves either. */
const replaceFile = (clonePath: string, relative: string, content: Buffer) => {
	const temp = path.join(clonePath, `${RESTORE_TEMP}${randomUUID()}.tmp`);
	fs.writeFileSync(temp, content, {flag: 'wx'});
	fs.mkdirSync(path.dirname(path.join(clonePath, relative)), {recursive: true});
	fs.renameSync(temp, path.join(clonePath, relative));
};

const refFilesOf = (clonePath: string): string[] => {
	const found: string[] = [];
	const visit = (relative: string) => {
		for (const entry of fs.readdirSync(path.join(clonePath, relative), {
			withFileTypes: true,
		})) {
			const child = path.join(relative, entry.name);
			if (entry.isDirectory()) visit(child);
			else found.push(child);
		}
	};
	if (fs.existsSync(path.join(clonePath, 'refs'))) visit('refs');
	return found;
};

/**
 * Every write replaces a file whole, and nothing is cleared before what goes
 * in its place is there: stopped at any point, the clone still opens.
 */
const restoreSnapshot = (clonePath: string, snapshot: CloneSnapshot) => {
	for (const [relative, content] of snapshot.refs) {
		replaceFile(clonePath, relative, content);
	}
	for (const relative of refFilesOf(clonePath)) {
		if (!snapshot.refs.has(relative)) {
			fs.rmSync(path.join(clonePath, relative), {force: true});
		}
	}

	for (const [name, content] of [
		['packed-refs', snapshot.packedRefs],
		['HEAD', snapshot.head],
		['config', snapshot.config],
		['shallow', snapshot.shallow],
	] as const) {
		if (content) replaceFile(clonePath, name, content);
		else fs.rmSync(path.join(clonePath, name), {force: true});
	}

	const packDir = path.join(clonePath, 'objects', 'pack');
	for (const name of listOr(packDir)) {
		if (!snapshot.packs.has(name)) fs.rmSync(path.join(packDir, name));
	}
	lastSeen.delete(clonePath);
};

/** The half-written packs of a transfer or a repack stopped partway. */
const clearTransferLeftovers = (gitDir: string) => {
	const objects = path.join(gitDir, 'objects');
	for (const [dir, prefix] of [
		[path.join(objects, 'pack'), 'tmp_'],
		[path.join(objects, 'pack'), '.tmp-'],
		[objects, 'incoming-'],
		[gitDir, RESTORE_TEMP],
	] as const) {
		try {
			for (const name of fs.readdirSync(dir)) {
				if (name.startsWith(prefix)) {
					fs.rmSync(path.join(dir, name), {recursive: true, force: true});
				}
			}
		} catch {
			// Nothing written there yet.
		}
	}
};

// Stock lines git follows the specific one with, naming no cause.
const GENERIC_GIT_LINE =
	/could not read from remote repository|the remote end hung up unexpectedly|early EOF|fetch-pack: invalid index-pack output/i;

/**
 * What a failed git call says to a person: git's first `fatal:` or `error:`
 * line that names a cause, not the argv `execGit` leads with. Whatever the
 * remote said is in it, so it is kept as plain text, and short.
 */
const gitReason = (message: string): string => {
	const lines = message
		.split('\n')
		.map(line => line.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '').trim())
		.filter(line => line && !line.startsWith('git '));
	const said = lines.filter(line => /^(fatal|error):/i.test(line));
	const specific = said.filter(line => !GENERIC_GIT_LINE.test(line));
	const reason =
		specific[0] ?? said[said.length - 1] ?? lines[lines.length - 1] ?? message;

	return reason.replace(/^(fatal|error):\s*/i, '').slice(0, 300);
};

// More than any project.json; a bigger one is no board's.
const PROJECT_FILE_MAX_BYTES = 64 * 1024;

/** The state branch the clone's project.json names, when it is an epiq board. */
const stateBranchOf = async (clonePath: string): Promise<string | null> => {
	const object = 'HEAD:.epiq/project.json';
	const size = await localGit({
		cwd: clonePath,
		args: ['cat-file', '-s', object],
	});
	if (
		isFail(size) ||
		!(Number(size.value.stdout.trim()) <= PROJECT_FILE_MAX_BYTES)
	) {
		return null;
	}

	const blob = await localGit({
		cwd: clonePath,
		args: ['cat-file', 'blob', object],
	});
	if (isFail(blob)) return null;

	try {
		const {stateBranch} = JSON.parse(blob.value.stdout) as {
			stateBranch?: unknown;
		};
		return typeof stateBranch === 'string' &&
			STATE_BRANCH_NAME.test(stateBranch)
			? stateBranch
			: null;
	} catch {
		return null;
	}
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
const deepenPastWindow = async (
	clonePath: string,
	undo?: CloneSnapshot,
): Promise<Result<null>> => {
	if (!(await hasRefs(clonePath))) return succeeded('Empty', null);

	const result = await transfer(
		clonePath,
		['fetch', '--no-tags', '--deepen=1', 'origin'],
		clonePath,
		{undo},
	);
	return isFail(result) ? failed(result.message) : succeeded('Deepened', null);
};

// A window with no commits in it is not an error worth failing a clone over:
// git refuses `--shallow-since` when it selects nothing, and one commit is
// the smallest history there is. That commit is a shallow boundary, which the
// timeline leaves out, so the repo simply shows nothing yet.
const NOTHING_SELECTED =
	/no commits selected for shallow requests|error processing shallow info/i;

/**
 * A whole clone at `pending`, beside the clone it is to become, or nothing
 * there at all: whatever fails takes the directory with it.
 */
const buildClone = async (
	pending: string,
	repo: CommitRepo,
	since: string | null,
): Promise<Result<null>> => {
	const clonesDir = path.dirname(pending);
	fs.mkdirSync(clonesDir, {recursive: true});
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

	let cloneResult = await transfer(
		clonesDir,
		args(since ? [shallowSince(since)] : []),
		pending,
	);
	let windowed = since !== null;

	if (
		isFail(cloneResult) &&
		since &&
		NOTHING_SELECTED.test(cloneResult.message)
	) {
		fs.rmSync(pending, {recursive: true, force: true});
		cloneResult = await transfer(clonesDir, args(['--depth=1']), pending);
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

	return succeeded('Built clone', null);
};

const cloneRepo = async (
	clonePath: string,
	repo: CommitRepo,
	since: string | null,
	/** In place of a clone that broke: the old one goes only once this lands. */
	{replace = false}: {replace?: boolean} = {},
): Promise<Result<null>> => {
	// Cloned beside its final name and moved into place, so a clone cut short
	// never looks like one that finished.
	const pending = `${clonePath}.${process.pid}.pending`;
	const built = await buildClone(pending, repo, since);
	if (isFail(built)) return built;

	// The old one moved aside, the new one in, and only then the old one
	// cleared: one that cannot be cleared leaves the new clone in place, and
	// the sweep collects what is left.
	if (replace && fs.existsSync(clonePath)) {
		const aside = `${clonePath}.${randomUUID()}.deleting`;
		fs.renameSync(clonePath, aside);
		fs.renameSync(pending, clonePath);
		try {
			fs.rmSync(aside, {recursive: true, force: true});
		} catch (error) {
			logger.info(
				`[repos] could not clear an old clone: ${errorMessage(error)}`,
			);
		}
		return succeeded('Cloned anew', null);
	}

	// Another process can only have got here first by breaking a lock it took
	// for abandoned; its clone is as good as this one.
	if (fs.existsSync(clonePath)) {
		fs.rmSync(pending, {recursive: true, force: true});
		return succeeded('Cloned elsewhere', null);
	}
	if (isLink(clonePath)) {
		fs.rmSync(pending, {recursive: true, force: true});
		return failed('The clone path is a link, which epiq will not use');
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

/** The branch the remote calls its default, or null where it does not say. */
const remoteDefaultOf = async (clonePath: string): Promise<string | null> => {
	const remote = await git(clonePath, [
		'ls-remote',
		'--symref',
		'origin',
		'HEAD',
	]);
	if (isFail(remote)) return null;

	const name = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(
		remote.value.stdout,
	)?.[1];
	// Followed only where it resolves: a HEAD naming a branch the remote does
	// not have is no default to read, and following it fails every fetch.
	const resolves = /^[0-9a-f]{40,64}\tHEAD$/m.test(remote.value.stdout);
	return name && resolves && (await isBranchName(clonePath, name))
		? name
		: null;
};

/** Points HEAD and the refspec at the branch the remote now calls its default. */
const followDefaultBranch = async (
	clonePath: string,
	known?: string,
): Promise<Result<null>> => {
	const name = known ?? (await remoteDefaultOf(clonePath));
	if (!name) {
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

// Each fetch lands as a pack of its own and nothing collects them: past this
// many, lookups and the size watch slow down, and they are merged.
export const MAX_CLONE_PACKS = 20;

const repackIfScattered = async (clonePath: string) => {
	const packs = listOr(path.join(clonePath, 'objects', 'pack')).filter(name =>
		name.endsWith('.pack'),
	);
	if (packs.length <= MAX_CLONE_PACKS) return;

	// Geometric: merges the small recent packs and leaves the big one be. A
	// failure costs only the merge; the clone is as it was.
	const result = await localGit({
		cwd: clonePath,
		args: ['repack', '--geometric=2', '-d', '-q'],
		timeoutMs: TRANSFER_TIMEOUT_MS,
	});
	if (isFail(result)) logger.info(`[repos] repack: ${result.message}`);
};

const refspecOf = async (clonePath: string): Promise<string | null> => {
	const result = await localGit({
		cwd: clonePath,
		args: ['config', '--get', 'remote.origin.fetch'],
	});
	return isFail(result) ? null : result.value.stdout.trim() || null;
};

const branchRefspec = (name: string) =>
	`+refs/heads/${name}:refs/heads/${name}`;

/** Points HEAD and the refspec where the repo's `branches` says, if not there. */
const trackBranches = async (
	clonePath: string,
	branches: RepoBranches,
): Promise<Result<null>> => {
	const refspec = await refspecOf(clonePath);

	if (branches === 'all') {
		const all = '+refs/heads/*:refs/heads/*';
		if (refspec === all) return succeeded('Tracking', null);
		const result = await localGit({
			cwd: clonePath,
			args: ['config', 'remote.origin.fetch', all],
		});
		return isFail(result)
			? failed(result.message)
			: succeeded('Tracking', null);
	}

	const head = await defaultBranchOf(clonePath);
	const target = (await remoteDefaultOf(clonePath)) ?? head;
	if (!target) return failed('Could not tell which branch is the default');
	if (head === target && refspec === branchRefspec(target)) {
		return succeeded('Tracking', null);
	}

	return followDefaultBranch(clonePath, target);
};

const fetchRepo = async (
	clonePath: string,
	repo: CommitRepo,
	since: string | null,
	previous: RepoFetchStatus | null,
): Promise<Result<null>> => {
	// Already past the cap — lowered since, or grown by a fetch that landed
	// just over it: read as it is, never fetched further.
	const maxMb = readRepoCloneMaxMb();
	if (dirSize(clonePath) > maxMb * 1024 * 1024) {
		return failed(cloneCapMessage(maxMb));
	}

	// Before anything moves: a refspec rewritten or a default followed is
	// put back with the refs if the fetch passes the cap.
	const before = snapshotOf(clonePath);

	// What the clone tracks, checked on every fetch rather than changed on
	// an event: a process stopped between two of these steps leaves them
	// disagreeing, and whatever the next fetch finds, it puts right. Under
	// `default` the remote's default is the one branch, HEAD names it and the
	// refspec fetches it; a remote that does not say keeps HEAD's.
	const trackResult = await trackBranches(clonePath, repo.branches);
	if (isFail(trackResult)) return failed(trackResult.message);

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
	let fetchResult = await transfer(clonePath, fetchArgs, clonePath, {
		undo: before,
	});

	// The remote renamed its default branch: the refspec still names the old
	// one, and would go on failing for good.
	if (
		isFail(fetchResult) &&
		repo.branches === 'default' &&
		/couldn't find remote ref/i.test(fetchResult.message)
	) {
		const followed = await followDefaultBranch(clonePath);
		if (isFail(followed)) return failed(followed.message);

		fetchResult = await transfer(clonePath, fetchArgs, clonePath, {
			undo: before,
		});
	}
	if (isFail(fetchResult)) return failed(fetchResult.message);

	if (window[0]?.startsWith('--shallow-since')) {
		const deepenResult = await deepenPastWindow(clonePath, before);
		if (isFail(deepenResult)) return failed(deepenResult.message);
	}

	if (repo.branches === 'default') await dropOtherBranches(clonePath);

	await repackIfScattered(clonePath);
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
	// Looked for as a link too, and written `wx`: a dangling link planted
	// under the name would otherwise have the file created wherever it
	// points, as this user.
	try {
		if (fs.lstatSync(ignore, {throwIfNoEntry: false})) return;
		fs.writeFileSync(ignore, '*\n', {flag: 'wx'});
	} catch (error) {
		logger.info(`[repos] could not write ${ignore}: ${errorMessage(error)}`);
	}
};

/** A link where a clone or its files should be: planted, and never used. */
const isLink = (target: string): boolean => {
	try {
		return fs.lstatSync(target).isSymbolicLink();
	} catch {
		return false;
	}
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
			checkProcess: true,
		});
		if (lock.acquired || Date.now() >= deadline) return lock;

		await new Promise(resolve => setTimeout(resolve, 250));
	}
};

/** The clone and its status, gone. Called holding the clone's lock. */
const deleteClone = (clonePath: string) => {
	// Moved aside first, in one step: a delete cut short leaves a directory
	// the sweep clears, never a half-clone under the clone's own name.
	const aside = `${clonePath}.${randomUUID()}.deleting`;
	try {
		fs.renameSync(clonePath, aside);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
	fs.rmSync(aside, {recursive: true, force: true});
	fs.rmSync(statusPath(clonePath), {force: true});
	fs.rmSync(removalMark(clonePath), {force: true});
	lastSeen.delete(clonePath);
};

// How long an explicit fetch waits for another process to let go of a clone.
// Its pass is usually a moment's check; a real fetch outlasts this, and is
// reported as one rather than as a fetch that happened here.
const EXPLICIT_LOCK_WAIT_MS = 5_000;

/**
 * Whether git can read the clone at all: its config names where it came from,
 * its shallow boundary is whole, and its branch tips walk. A clone failing any
 * of these reads as empty or fails every read, while its fetches go on.
 */
const cloneOpens = async (clonePath: string): Promise<boolean> => {
	const origin = await localGit({
		cwd: clonePath,
		args: ['config', '--get', 'remote.origin.url'],
	});
	if (isFail(origin) || !origin.value.stdout.trim()) return false;

	const shallow = readOrNull(path.join(clonePath, 'shallow'));
	if (
		shallow &&
		!/^(?:[0-9a-f]{40}(?:[0-9a-f]{24})?\n)*$/.test(shallow.toString('utf8'))
	) {
		return false;
	}

	if (!(await hasRefs(clonePath))) return true;
	return !isFail(
		await localGit({
			cwd: clonePath,
			args: ['rev-list', '--max-count=1', '--branches'],
		}),
	);
};

// Between start-overs of a clone that goes on breaking: at once the first
// time, then longer, so one that breaks again straight away is no loop and
// one broken again hours later is not left failing for hours.
const RESTART_BACKOFF_MS = [0, 60_000, 10 * 60_000, 60 * 60_000];

const backedOff = (status: RepoFetchStatus | null) => {
	if (!status?.restartTriedAt || Date.now() < status.restartTriedAt) {
		return true;
	}
	const wait =
		RESTART_BACKOFF_MS[
			Math.min(status.restarts, RESTART_BACKOFF_MS.length - 1)
		]!;
	return Date.now() - status.restartTriedAt >= wait;
};

// A fetch that fails while the remote answers may be the remote's passing
// trouble rather than the clone: a fresh clone for it at most this often.
const FAILED_FETCH_RESTART_MS = 6 * 60 * 60 * 1000;

const mayStartOverFailedFetch = (status: RepoFetchStatus | null) => {
	// From the last try, landed or not: one that keeps failing is the remote's
	// trouble too, and is not repeated every hour.
	const last = status?.restartTriedAt ?? status?.restartedAt;
	return (
		backedOff(status) &&
		(!last || Date.now() < last || Date.now() - last >= FAILED_FETCH_RESTART_MS)
	);
};

// A look at the remote, not a transfer: well under what counts as waiting.
const REACHABLE_TIMEOUT_MS = 60_000;

/**
 * Why a failed fetch looks like the clone's fault rather than the remote's:
 * the clone alone is past the cap, or the remote answers by its URL while the
 * clone's own fetch of it failed. A fetch the cap stopped is the remote's
 * growth, and a fresh clone would hit the same cap.
 */
const brokeHere = async (
	clonePath: string,
	repo: CommitRepo,
	failure: string,
): Promise<'past the cap' | 'remote answers' | null> => {
	const maxMb = readRepoCloneMaxMb();
	if (dirSize(clonePath) > maxMb * 1024 * 1024) return 'past the cap';
	if (failure.endsWith(cloneCapMessage(maxMb))) return null;

	return (await remoteAnswers(clonePath, repo)) ? 'remote answers' : null;
};

/** Whether the repo's URL answers, asked beside the clone rather than of it. */
const remoteAnswers = async (clonePath: string, repo: CommitRepo) =>
	!isFail(
		await localGit({
			cwd: path.dirname(clonePath),
			args: ['ls-remote', '--', repo.url, 'HEAD'],
			timeoutMs: REACHABLE_TIMEOUT_MS,
		}),
	);

const fetchOne = async (
	repoRoot: string,
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
		// Options that changed are a reason to fetch again, unless the last
		// attempt failed: then the remote is the reason, and changing an
		// option on a dead one must not turn the throttle off.
		(previous.error !== null ||
			(previous.branches === repo.branches && previous.since === since)) &&
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

	if (isLink(clonePath)) {
		return outcome(false, 'The clone path is a link, which epiq will not use');
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
		// A remove that found the clone in use before this fetch began, or
		// one that landed after this pass read its list: honoured, and not
		// undone by a clone of what it removed. A list that merely changed
		// under the pass — a branch switch, a pull — is no remove, and the
		// clone goes ahead: other worktrees may still list it.
		const removed = fs.existsSync(removalMark(clonePath));
		if (removed) deleteClone(clonePath);

		let cloned = fs.existsSync(clonePath);

		// A clone is fetched from wherever it was cloned from, so one that names
		// another repo is not this one's, and it is started over: it is epiq's
		// own copy. One whose config merely could not be read is left as it is.
		if (cloned && (await originOf(clonePath, repo)) === 'other') {
			deleteClone(clonePath);
			cloned = false;
		}

		const current = cloned ? readStatus(clonePath) : null;

		// This process's first look: what the clone held before this fetch.
		if (cloned && !lastSeen.has(clonePath)) {
			lastSeen.set(clonePath, await refsOf(clonePath));
		}

		// A git's leftovers, found under the clone's lock, are a dead git's.
		if (cloned) {
			clearStaleGitLocks(clonePath);
			clearTransferLeftovers(clonePath);
		}

		if (!cloned && removed && !isRepoListed(repoRoot, repo.id)) {
			return outcome(true, 'Removed before it was cloned');
		}

		// The clone is a cache: one that broke here — it will not open, its
		// config is gone, packs a stopped repack left doubled past the cap —
		// is started over rather than failing for good. Only when the remote
		// itself answers or the clone cannot be read at all, and at most once
		// in a while.
		const broken = cloned && !(await cloneOpens(clonePath));
		// Only with the remote there: a fresh clone of an unreachable one would
		// fail, and that failure says nothing about this clone.
		const due = broken && backedOff(current);
		let restarted = due && (await remoteAnswers(clonePath, repo));
		let result = !cloned
			? await cloneRepo(clonePath, repo, since)
			: due
			? failed(
					restarted
						? 'Its clone will not open'
						: 'Its clone will not open, and its remote does not answer',
			  )
			: await fetchRepo(clonePath, repo, since, current);

		if (
			cloned &&
			!restarted &&
			isFail(result) &&
			mayStartOverFailedFetch(current)
		) {
			const why = await brokeHere(clonePath, repo, result.message);
			// Once more first: a connection dropped partway is no broken clone.
			if (why === 'remote answers') {
				result = await fetchRepo(clonePath, repo, since, current);
			}
			restarted = why !== null && isFail(result);
		}

		if (restarted) {
			logger.info(`[repos] ${repo.label}: starting its clone over`);
			result = await cloneRepo(clonePath, repo, since, {replace: true});
			lastSeen.delete(clonePath);
		}
		const counted = restarted && !(isFail(result) && isShuttingDown());
		const message = isFail(result) ? gitReason(result.message) : 'Fetched';
		const stateBranch = isFail(result)
			? current?.stateBranch ?? null
			: await stateBranchOf(clonePath);

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
			stateBranch,
			// Landed only: one that failed is tried again on the backoff.
			restartedAt:
				restarted && !isFail(result)
					? Date.now()
					: current?.restartedAt ?? null,
			// A try counts toward the backoff only when it reached the remote
			// and was not cut short by this process stopping.
			restartTriedAt: counted ? Date.now() : current?.restartTriedAt ?? null,
			// Counted until the clone fetches as itself again.
			restarts: counted
				? (current?.restarts ?? 0) + 1
				: isFail(result)
				? current?.restarts ?? 0
				: 0,
			// Measured here, under the lock, so a panel showing it never reads
			// the disk.
			bytes: isFail(result) ? current?.bytes ?? null : dirSize(clonePath),
		});

		if (isFail(result)) {
			logger.info(`[repos] ${repo.label}: ${result.message}`);
			return outcome(false, message);
		}

		return outcome(
			true,
			message,
			movedSinceSeen(clonePath, await refsOf(clonePath)) ||
				!cloned ||
				restarted,
		);
	} catch (error) {
		// A filesystem refusal is this repo's failure, never the process's: the
		// GUI starts this without awaiting it.
		logger.info(`[repos] ${repo.label}: ${errorMessage(error)}`);
		return outcome(false, errorMessage(error));
	} finally {
		// Removed while this fetch held it: it goes now, rather than staying.
		// The lock is let go whatever the delete did: one it could not finish
		// — a file held open, a directory this user cannot write — must not
		// leave every later fetch of this repo waiting on a lock nobody holds.
		try {
			if (fs.existsSync(removalMark(clonePath))) deleteClone(clonePath);
		} catch (error) {
			logger.info(
				`[repos] ${repo.label}: could not delete the clone: ${errorMessage(
					error,
				)}`,
			);
		}
		lock.release();
		deleteIfMarked(clonePath);
	}
};

/**
 * A remove marked the clone while somebody held it. Checked by the holder once
 * it lets go, and by the remover once it has marked: whichever comes second
 * finds the lock free.
 */
const deleteIfMarked = (clonePath: string) => {
	if (!fs.existsSync(removalMark(clonePath))) return;

	const lock = acquireLockFile({
		lockPath: `${clonePath}${LOCK_SUFFIX}`,
		operation: 'remove',
		staleAfterMs: CLONE_LOCK_STALE_MS,
		checkProcess: true,
	});
	if (!lock.acquired) return;

	// A delete that cannot finish is logged, not thrown: the mark stays for
	// the next holder to try, and the lock is let go either way.
	try {
		if (fs.existsSync(removalMark(clonePath))) deleteClone(clonePath);
	} catch (error) {
		logger.info(`[repos] could not delete a clone: ${errorMessage(error)}`);
	} finally {
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
		const pending =
			/^.+\.git(?:\.json)?\.(\d+)(?:\.[0-9a-f-]{36})?\.(?:pending|tmp)$/.exec(
				name,
			);
		if (
			(pending && !isAlive(Number(pending[1]))) ||
			// A delete stopped partway: nobody else ever names it.
			/\.git\.[0-9a-f-]{36}\.deleting$/.test(name)
		) {
			// One that cannot go is left for a later pass; the rest still go.
			try {
				fs.rmSync(path.join(dir, name), {recursive: true, force: true});
			} catch (error) {
				logger.info(`[repos] could not sweep ${name}: ${errorMessage(error)}`);
			}
		}
	}
};

/**
 * A clone made ahead of a connect, for the pre-flight to read and the confirm
 * to move into place. Named as a pending clone of this process, so a process
 * that dies leaves it to `sweepPending`.
 */
export const stageClone = async (
	repoRoot: string,
	repo: CommitRepo,
): Promise<Result<{stagePath: string; bytes: number}>> => {
	const projectResult = readRepoProject(repoRoot);
	if (isFail(projectResult)) return failed(projectResult.message);

	const clonePath = getRepoClonePath(projectResult.value.projectId, repo.id);
	const stagePath = `${clonePath}.${process.pid}.${randomUUID()}.pending`;

	try {
		fs.mkdirSync(path.dirname(clonePath), {recursive: true});
		ignoreClonesDir(path.dirname(clonePath));

		const built = await buildClone(
			stagePath,
			repo,
			sinceDate(repo.since, projectResult.value.createdAt),
		);
		if (isFail(built)) return failed(gitReason(built.message));

		return succeeded('Staged', {stagePath, bytes: dirSize(stagePath)});
	} catch (error) {
		discardStage(stagePath);
		return failed(errorMessage(error));
	}
};

export const discardStage = (stagePath: string) => {
	try {
		fs.rmSync(stagePath, {recursive: true, force: true});
	} catch (error) {
		logger.info(`[repos] could not clear a stage: ${errorMessage(error)}`);
	}
};

/**
 * Moves a staged clone into place once its connect is written. Never undoes
 * the connect: a stage that cannot move is cleared, and the next fetch clones.
 */
export const adoptStagedClone = async (
	repoRoot: string,
	repo: CommitRepo,
	stagePath: string,
): Promise<void> => {
	const projectResult = readRepoProject(repoRoot);
	if (isFail(projectResult)) return discardStage(stagePath);

	const {projectId, createdAt} = projectResult.value;
	const clonePath = getRepoClonePath(projectId, repo.id);

	const lock = await takeCloneLock(
		clonePath,
		`connect ${repo.label}`,
		EXPLICIT_LOCK_WAIT_MS,
	);
	if (!lock.acquired) return discardStage(stagePath);

	try {
		// A reconnect: the mark a disconnect left is the old repo's, not this.
		fs.rmSync(removalMark(clonePath), {force: true});

		if (fs.existsSync(clonePath) || isLink(clonePath)) {
			return discardStage(stagePath);
		}

		fs.renameSync(stagePath, clonePath);
		writeStatus(clonePath, {
			fetchedAt: Date.now(),
			attemptedAt: Date.now(),
			error: null,
			branches: repo.branches,
			since: sinceDate(repo.since, createdAt),
			stateBranch: await stateBranchOf(clonePath),
			restartedAt: null,
			restartTriedAt: null,
			restarts: 0,
			bytes: dirSize(clonePath),
		});
		invalidateCommitTimelineCache();
	} catch (error) {
		logger.info(
			`[repos] could not place ${repo.label}: ${errorMessage(error)}`,
		);
		discardStage(stagePath);
	} finally {
		lock.release();
	}
};

/**
 * Takes a repo off the list, then this machine's clone of it: the event goes
 * first, so a clone is never gone while the board still reads the repo.
 */
export const disconnectCommitRepo = (input: {
	repoRoot: string;
	actorId: string;
	repo: string;
}): Result<CommitRepo> => {
	const found = findConnectedRepo(input.repoRoot, input.repo);
	if (isFail(found)) return found;

	const written = writeRepoEvent({
		repoRoot: input.repoRoot,
		actorId: input.actorId,
		event: {action: 'disconnect.repo', payload: {repo: found.value.id}},
	});
	if (isFail(written)) return failed(written.message);

	const cloneResult = removeRepoClone({
		repoRoot: input.repoRoot,
		repoId: found.value.id,
	});
	invalidateCommitTimelineCache();

	const message = `Disconnected ${found.value.label}`;
	return isFail(cloneResult)
		? succeeded(
				`${message}, but its clone stays: ${cloneResult.message}`,
				found.value,
		  )
		: succeeded(message, found.value);
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

	// A repo never fetched on this machine has no clones dir yet; the lock and
	// the mark it leaves need one.
	try {
		fs.mkdirSync(path.dirname(clonePath), {recursive: true});
	} catch (error) {
		return failed(`Could not remove the clone: ${errorMessage(error)}`);
	}

	const lock = acquireLockFile({
		lockPath: `${clonePath}${LOCK_SUFFIX}`,
		operation: 'remove',
		staleAfterMs: CLONE_LOCK_STALE_MS,
		checkProcess: true,
	});

	try {
		if (!lock.acquired) {
			placeRemovalMark(clonePath);
			deleteIfMarked(clonePath);
			return succeeded('Removed once its fetch ends', null);
		}

		deleteClone(clonePath);
		// Left as a tombstone for a pass that read its list before this: it
		// would otherwise clone the repo again. Never swept, since that pass
		// may be in another worktree; the next clone after a re-add clears it.
		placeRemovalMark(clonePath);
		return succeeded('Removed clone', null);
	} catch (error) {
		return failed(`Could not remove the clone: ${String(error)}`);
	} finally {
		if (lock.acquired) lock.release();
	}
};

const sweepDisconnected = (
	repoRoot: string,
	projectId: string,
	disconnected: readonly string[],
) => {
	for (const repoId of disconnected) {
		if (!fs.existsSync(getRepoClonePath(projectId, repoId))) continue;

		const removed = removeRepoClone({repoRoot, repoId});
		if (isFail(removed)) {
			logger.info(`[repos] could not clear ${repoId}: ${removed.message}`);
		} else {
			invalidateCommitTimelineCache();
		}
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

	const reposResult = readConnectedRepos(repoRoot);
	if (isFail(reposResult)) return failed(reposResult.message);

	const {projectId, createdAt} = projectResult.value;
	const repos = reposResult.value.live;

	try {
		sweepPending(projectId);
	} catch (error) {
		logger.info(`[repos] sweep failed: ${String(error)}`);
	}

	// Only what a disconnect in a log that read whole names: a repo merely
	// missing from the list is never a reason to delete anything.
	sweepDisconnected(repoRoot, projectId, reposResult.value.disconnected);

	if (repos.length === 0) return succeeded('No other repos', []);

	const outcomes: RepoFetchOutcome[] = [];
	for (let start = 0; start < repos.length; start += CONCURRENCY) {
		outcomes.push(
			...(await Promise.all(
				repos
					.slice(start, start + CONCURRENCY)
					.map(repo =>
						fetchOne(repoRoot, projectId, createdAt, repo, minIntervalMs),
					),
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
	const skipped = outcomes.filter(outcome => outcome.skipped);

	const parts = [
		failedRepos.length > 0 &&
			`could not fetch ${failedRepos
				.map(outcome => `${outcome.label} (${outcome.message.slice(0, 80)})`)
				.join(', ')}`,
		skipped.length > 0 &&
			`another process is fetching ${skipped
				.map(outcome => outcome.label)
				.join(', ')}`,
	].filter(Boolean);

	return parts.length > 0 ? parts.join('; ') : null;
};
