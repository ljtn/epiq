import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {acquireLockFile} from '../../git/sync-lock.js';
import {logger} from '../../logger.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {readProjectFile} from '../project-setup/project-setup.js';
import {getGlobalConfigDir} from '../storage/global-config-dir.js';
import {getProjectFilePath} from '../storage/paths.js';
import {isAllowedRepoUrl, repoUrlProblem, REPO_URL_FORMS} from './repo-url.js';

export {isAllowedRepoUrl, repoUrlProblem} from './repo-url.js';

// Other repositories whose commits count as this board's, registered by remote
// URL in `project.json` so every clone of the board names the same ones.
//
// Read leniently and apart from `EpiqProjectSchema`: an entry this build cannot
// read is skipped, never a reason to refuse the project file — a newer build
// may write shapes this one does not know.

export type RepoBranches = 'default' | 'all';

/** `board` (when the board was created), `all`, or a `YYYY-MM-DD` date. */
export type RepoSince = string;

export type CommitRepoConfig = {
	url: string;
	branches: RepoBranches;
	since: RepoSince;
	/** What the repo is called on the board, where its URL's basename is not. */
	label?: string;
};

export type CommitRepo = CommitRepoConfig & {
	/** Stable across machines: derived from the URL alone. */
	id: string;
	label: string;
};

export const REPOS_KEY = 'repos';

/** The answer to an add that names a repo already listed just so. */
export const REPO_UNCHANGED = 'Unchanged';
/** How the answer to a change of label alone opens: no commit moved. */
export const REPO_RENAMED = 'Renamed ';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// A label as a derived one is cut: short, lowercase, nothing a command line
// splits on or a chip would wrap.
const LABEL = /^[a-z0-9][a-z0-9._-]{0,23}$/;
// How an id ends. A label is never let look like one: a repo is named by
// either, and a label would win.
const ID_HASH = /-[0-9a-f]{12}$/;

/**
 * How many repos one board reads. The list is a committed file; past this, a
 * hostile one is asking for a clone of everything, not describing a project.
 */
export const MAX_REPOS = 20;

export const isRepoSince = (value: string): boolean =>
	value === 'board' || value === 'all' || isCalendarDate(value);

// A day that exists, as itself: `Date` rolls 2025-02-30 into March. From
// 1970 on, since git takes the window as an epoch.
const isCalendarDate = (value: string): boolean => {
	if (!DATE.test(value) || value < '1970-01-01') return false;
	const parsed = new Date(`${value}T00:00:00Z`);

	return (
		!Number.isNaN(parsed.getTime()) &&
		parsed.toISOString().slice(0, 10) === value
	);
};

export const isRepoLabel = (value: string): boolean =>
	LABEL.test(value) && !ID_HASH.test(value);

const normalizeUrl = (url: string): string =>
	url
		.trim()
		.replace(/\/+$/, '')
		.replace(/\.git$/i, '')
		.toLowerCase();

/** What a repo is called unless a label says otherwise: its URL's basename. */
export const repoLabelOfUrl = (url: string): string => {
	const last = normalizeUrl(url).split(/[/:]/).filter(Boolean).pop() ?? '';
	// Short: it names a directory, and Windows caps a whole path at 260.
	const slug = last.replace(/[^a-z0-9._-]/g, '-').slice(0, 24);

	return slug.replace(/^[.-]+/, '') || 'repo';
};

const labelOf = repoLabelOfUrl;

export const repoIdOf = (url: string): string =>
	`${labelOf(url)}-${createHash('sha1')
		.update(normalizeUrl(url))
		.digest('hex')
		.slice(0, 12)}`;

/** Whether the project file still lists the repo: read fresh, never cached. */
export const isRepoListed = (repoRoot: string, repoId: string): boolean => {
	const repos = readCommitRepos(repoRoot);
	return !isFail(repos) && repos.value.some(repo => repo.id === repoId);
};

/** The label back off an id, which carries it ahead of the URL's hash. */
export const repoLabelOfId = (repoId: string): string =>
	repoId.replace(ID_HASH, '');

const toRepo = (config: CommitRepoConfig): CommitRepo => ({
	...config,
	id: repoIdOf(config.url),
	label: config.label ?? labelOf(config.url),
});

const parseEntry = (entry: unknown): CommitRepoConfig | null => {
	const raw =
		typeof entry === 'string'
			? {url: entry}
			: entry && typeof entry === 'object'
			? (entry as Record<string, unknown>)
			: null;
	if (!raw || typeof raw['url'] !== 'string') return null;

	const url = raw['url'].trim();
	if (!isAllowedRepoUrl(url)) return null;

	const branches = raw['branches'] === 'all' ? 'all' : 'default';
	const since =
		typeof raw['since'] === 'string' && isRepoSince(raw['since'])
			? raw['since']
			: 'board';

	const label =
		typeof raw['label'] === 'string' && isRepoLabel(raw['label'])
			? raw['label']
			: undefined;

	return {url, branches, since, ...(label ? {label} : {})};
};

const readRawProject = (repoRoot: string): Result<Record<string, unknown>> => {
	try {
		const json = JSON.parse(
			fs.readFileSync(getProjectFilePath(repoRoot), 'utf8'),
		) as unknown;

		return json && typeof json === 'object' && !Array.isArray(json)
			? succeeded('Read project.json', json as Record<string, unknown>)
			: failed('Invalid .epiq/project.json');
	} catch (error) {
		return failed(
			`Failed to read .epiq/project.json: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
};

export const readCommitRepos = (repoRoot: string): Result<CommitRepo[]> => {
	const rawResult = readRawProject(repoRoot);
	if (isFail(rawResult)) return failed(rawResult.message);

	const entries = rawResult.value[REPOS_KEY];
	if (entries === undefined) return succeeded('No other repos', []);
	if (!Array.isArray(entries)) {
		logger.info('[repos] project.json `repos` is not a list; ignored');
		return succeeded('No other repos', []);
	}

	const seen = new Set<string>();
	const repos: CommitRepo[] = [];
	let unreadable = 0;

	// Looked at up to a bound, and skipped entries counted rather than each
	// logged: this runs on every read, and the list is a committed file.
	for (const entry of entries.slice(0, MAX_REPOS * 5)) {
		const config = parseEntry(entry);
		if (!config) {
			unreadable++;
			continue;
		}

		const repo = toRepo(config);
		if (seen.has(repo.id)) continue;

		if (repos.length === MAX_REPOS) break;

		seen.add(repo.id);
		repos.push(repo);
	}

	if (unreadable > 0 || entries.length > MAX_REPOS * 5) {
		logger.debug(
			`[repos] read ${repos.length} of ${entries.length} entries; ${unreadable} unreadable`,
		);
	}

	return succeeded('Read other repos', repos);
};

/**
 * The project file, if it is one this process may write. It arrives with the
 * code, so a repository can commit it as a link — to a shell profile, say —
 * and writing through that link would rewrite the file it points at. So: a
 * plain file, inside the repository, or nothing.
 */
const writableProjectFile = (repoRoot: string): Result<string> => {
	const target = getProjectFilePath(repoRoot);

	try {
		if (!fs.lstatSync(target).isFile()) {
			return failed('.epiq/project.json is not a plain file; not writing it');
		}

		const root = fs.realpathSync(repoRoot);
		const real = fs.realpathSync(target);
		// Through a linked `.epiq` directory too: the file must be this one.
		if (path.relative(root, real) !== path.join('.epiq', 'project.json')) {
			return failed('.epiq/project.json resolves outside the repository');
		}
	} catch (error) {
		return failed(
			`Cannot write .epiq/project.json: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	return succeeded('Writable', target);
};

/** A write of project.json a process died partway through, left in `.epiq/`. */
const sweepDeadTemps = (dir: string) => {
	for (const name of fs.readdirSync(dir)) {
		const match = /^project\.json\.(\d+)\.tmp$/.exec(name);
		if (!match) continue;

		try {
			process.kill(Number(match[1]), 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EPERM') {
				fs.rmSync(path.join(dir, name), {force: true});
			}
		}
	}
};

/** The `repos` list as written, entries this build cannot read included. */
const readRawEntries = (project: Record<string, unknown>): unknown[] => {
	const entries = project[REPOS_KEY];
	return Array.isArray(entries) ? entries : [];
};

const idOfEntry = (entry: unknown): string | null => {
	const config = parseEntry(entry);
	return config ? repoIdOf(config.url) : null;
};

/**
 * Rewrites only the `repos` key, keeping every other key and its order — a
 * newer build's fields included — and every entry the edit did not touch, as
 * it was written. An empty list removes the key, so the file goes back to
 * exactly what an older build wrote.
 */
const editRawEntries = (
	repoRoot: string,
	edit: (entries: unknown[]) => unknown[],
): Result<null> => {
	const targetResult = writableProjectFile(repoRoot);
	if (isFail(targetResult)) return failed(targetResult.message);

	return editRawEntriesHeld(repoRoot, targetResult.value, edit);
};

/**
 * Runs a read-check-write of the repo list under one lock: a GUI, a TUI and an
 * MCP server editing at once would otherwise each write back a list missing
 * the others' change, or each let in a twenty-first repo.
 */
const whileEditingProjectFile = <T>(
	repoRoot: string,
	body: () => Result<T>,
): Result<T> => {
	const targetResult = writableProjectFile(repoRoot);
	if (isFail(targetResult)) return failed(targetResult.message);

	let lock: ReturnType<typeof takeProjectFileLock>;
	try {
		lock = takeProjectFileLock(repoRoot);
	} catch (error) {
		return failed(
			`Could not lock .epiq/project.json: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	if (!lock.acquired) {
		return failed('Another process is editing .epiq/project.json; try again');
	}

	try {
		return body();
	} finally {
		lock.release();
	}
};

// An edit holds it for a moment; a wait this long means a holder that is
// stuck. Short, since the wait blocks the process: the GUI server among them.
const PROJECT_FILE_LOCK_WAIT_MS = 1_000;

/** Outside the checkout, so a lock never shows in `git status`. */
export const projectFileLockPath = (repoRoot: string): string =>
	path.join(
		getGlobalConfigDir(),
		'locks',
		`${createHash('sha1')
			.update(fs.realpathSync(getProjectFilePath(repoRoot)))
			.digest('hex')}.project.lock`,
	);

const takeProjectFileLock = (repoRoot: string) => {
	const lockPath = projectFileLockPath(repoRoot);
	fs.mkdirSync(path.dirname(lockPath), {recursive: true});

	const deadline = Date.now() + PROJECT_FILE_LOCK_WAIT_MS;
	const pause = new Int32Array(new SharedArrayBuffer(4));
	while (true) {
		const lock = acquireLockFile({
			lockPath,
			operation: 'edit project.json',
			checkProcess: true,
		});
		if (lock.acquired || Date.now() >= deadline) return lock;
		Atomics.wait(pause, 0, 0, 20);
	}
};

const editRawEntriesHeld = (
	repoRoot: string,
	target: string,
	edit: (entries: unknown[]) => unknown[],
): Result<null> => {
	const rawResult = readRawProject(repoRoot);
	if (isFail(rawResult)) return failed(rawResult.message);

	const entries = edit(readRawEntries(rawResult.value));
	const next: Record<string, unknown> = {...rawResult.value};
	if (entries.length === 0) {
		delete next[REPOS_KEY];
	} else {
		next[REPOS_KEY] = entries;
	}

	const pending = `${target}.${process.pid}.tmp`;

	try {
		// Beside it, then renamed over it: a rename replaces the entry itself,
		// so a crash mid-write never leaves half a file, and nothing is written
		// through a link.
		sweepDeadTemps(path.dirname(target));
		fs.rmSync(pending, {force: true});
		fs.writeFileSync(pending, JSON.stringify(next, null, 2) + '\n', {
			encoding: 'utf8',
			flag: 'wx',
		});
		fs.renameSync(pending, target);
	} catch (error) {
		// Never left in `.epiq/`, where it would show in `git status`.
		fs.rmSync(pending, {force: true});
		return failed(
			`Failed to write .epiq/project.json: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	return succeeded('Wrote project.json', null);
};

type RepoChange = {
	repoRoot: string;
	url: string;
	branches?: RepoBranches;
	since?: RepoSince;
	/** What to call it; empty goes back to the URL's basename. */
	label?: string;
};

/** Adds a repo, or changes the options of one already listed. */
export const upsertCommitRepo = (input: RepoChange): Result<CommitRepo> =>
	whileEditingProjectFile(input.repoRoot, () => upsertHeld(input));

const upsertHeld = (input: RepoChange): Result<CommitRepo> => {
	const url = input.url.trim();
	const problem = repoUrlProblem(url);
	if (problem) {
		return failed(`That URL ${problem}. ${REPO_URL_FORMS}`);
	}
	if (input.since !== undefined && !isRepoSince(input.since)) {
		return failed(
			`"${input.since}" is not a history window: use board, all or YYYY-MM-DD.`,
		);
	}
	const typedLabel = input.label?.trim();
	if (typedLabel && !isRepoLabel(typedLabel)) {
		return failed(
			`"${typedLabel}" is not a label: up to 24 of a-z, 0-9, dot, dash or underscore, opening on a letter or digit.`,
		);
	}

	const reposResult = readCommitRepos(input.repoRoot);
	if (isFail(reposResult)) return failed(reposResult.message);

	const id = repoIdOf(url);
	const existing = reposResult.value.find(repo => repo.id === id);

	// Written only where it says something the URL does not; left as it is
	// when nothing was said about it.
	const keptLabel =
		existing && existing.label !== labelOf(existing.url)
			? existing.label
			: undefined;
	const label =
		typedLabel === undefined
			? keptLabel
			: typedLabel && typedLabel !== labelOf(url)
			? typedLabel
			: undefined;

	// The point of a label is telling two repos apart. A derived one is never
	// refused: two forks share a basename before anybody names one.
	if (
		label &&
		reposResult.value.some(repo => repo.id !== id && repo.label === label)
	) {
		return failed(`Another repo is already called ${label}`);
	}

	const config: CommitRepoConfig = {
		url: existing?.url ?? url,
		branches: input.branches ?? existing?.branches ?? 'default',
		since: input.since ?? existing?.since ?? 'board',
		...(label ? {label} : {}),
	};

	// Nothing to write, and nothing for a reader to start over on.
	if (
		existing &&
		existing.branches === config.branches &&
		existing.since === config.since &&
		existing.label === toRepo(config).label
	) {
		return succeeded(REPO_UNCHANGED, existing);
	}

	if (!existing && reposResult.value.length >= MAX_REPOS) {
		return failed(`A board reads at most ${MAX_REPOS} other repos`);
	}

	const writeResult = editRawEntries(input.repoRoot, entries => {
		// The first entry for this repo takes the change, keeping any field a
		// newer build gave it; a later duplicate is left as it was.
		const index = entries.findIndex(entry => idOfEntry(entry) === id);
		if (index === -1) return [...entries, config];

		const written = entries[index];
		const kept =
			written && typeof written === 'object' && !Array.isArray(written)
				? (written as Record<string, unknown>)
				: {};

		// `label` set outright: a cleared one must leave the entry.
		return entries.map((entry, at) =>
			at === index ? {...kept, ...config, label: config.label} : entry,
		);
	});
	if (isFail(writeResult)) return failed(writeResult.message);

	const repo = toRepo(config);
	const renamed =
		existing &&
		existing.branches === config.branches &&
		existing.since === config.since;

	return succeeded(
		existing
			? `${renamed ? REPO_RENAMED : 'Updated '}${repo.label}`
			: `Added ${repo.label}`,
		repo,
	);
};

/** The registered repos' labels by id, for a reader that holds only ids. */
export const repoLabelsById = (
	repoRoot: string,
): ReadonlyMap<string, string> => {
	const reposResult = readCommitRepos(repoRoot);

	return new Map(
		isFail(reposResult)
			? []
			: reposResult.value.map(repo => [repo.id, repo.label]),
	);
};

/** The names a repo can be called by: its label where that is unique, else its id. */
export const removableNames = (repos: CommitRepo[]): string[] =>
	repos.map(repo =>
		repos.filter(other => other.label === repo.label).length === 1
			? repo.label
			: repo.id,
	);

/** The repo a name stands for: a unique label, an id, or a URL. */
export const findCommitRepo = (
	repos: CommitRepo[],
	name: string,
): Result<CommitRepo> => {
	const typed = name.trim();
	const byLabel = repos.filter(repo => repo.label === typed);
	if (byLabel.length > 1) {
		return failed(
			`Several repos are called ${typed} — name one by its id or URL`,
		);
	}

	const match =
		byLabel[0] ??
		repos.find(
			repo =>
				repo.id === typed ||
				(isAllowedRepoUrl(typed) && repo.id === repoIdOf(typed)),
		);

	return match
		? succeeded('Found', match)
		: failed(`No repo "${typed}" is registered`);
};

export const removeCommitRepo = (input: {
	repoRoot: string;
	/** A unique label, the repo's id, or its URL. */
	repo: string;
}): Result<CommitRepo> =>
	whileEditingProjectFile(input.repoRoot, () => removeHeld(input));

const removeHeld = (input: {
	repoRoot: string;
	repo: string;
}): Result<CommitRepo> => {
	const reposResult = readCommitRepos(input.repoRoot);
	if (isFail(reposResult)) return failed(reposResult.message);

	const matchResult = findCommitRepo(reposResult.value, input.repo);
	if (isFail(matchResult)) return failed(matchResult.message);
	const match = matchResult.value;

	const writeResult = editRawEntries(input.repoRoot, entries =>
		entries.filter(entry => idOfEntry(entry) !== match.id),
	);
	if (isFail(writeResult)) return failed(writeResult.message);

	return succeeded(`Removed ${match.label}`, match);
};

/**
 * Outside the checkout, keyed by project: every worktree of one board shares a
 * clone, and nothing epiq fetches can ever show up in `git status`.
 */
export const getRepoClonesDir = (projectId: string): string =>
	path.join(
		getGlobalConfigDir(),
		'repos',
		// The id comes from a committed file, and this directory gets swept.
		/^[\w-]+$/.test(projectId)
			? projectId
			: createHash('sha1').update(projectId).digest('hex'),
	);

/** A clone directory's name, and nothing else the sweep could be pointed at. */
export const CLONE_DIR_NAME = /^[a-z0-9._-]+-[0-9a-f]{12}\.git$/;

export const getRepoClonePath = (projectId: string, repoId: string): string =>
	path.join(getRepoClonesDir(projectId), `${repoId}.git`);

// Beside the clone rather than in it, so a first clone that fails — and
// leaves no clone — still records why.
export const cloneStatusPath = (clonePath: string) => `${clonePath}.json`;

/** A state branch as a clone's own project.json may name it: a plain ref name. */
export const STATE_BRANCH_NAME = /^(?!-)[A-Za-z0-9._/-]{1,100}$/;

/**
 * The state branch the clone's last fetch found its project.json naming: a
 * linked repo that is an epiq board keeps its event log there, not its work.
 */
export const readCloneStateBranch = (clonePath: string): string | null => {
	try {
		const raw = JSON.parse(
			fs.readFileSync(cloneStatusPath(clonePath), 'utf8'),
		) as {stateBranch?: unknown};

		return typeof raw.stateBranch === 'string' &&
			STATE_BRANCH_NAME.test(raw.stateBranch)
			? raw.stateBranch
			: null;
	} catch {
		return null;
	}
};

/** The date a `since` stands for, or null for the whole history. */
export const sinceDate = (
	since: RepoSince,
	boardCreatedAt: string,
): string | null => {
	if (since === 'all') return null;
	if (since === 'board') return boardCreatedAt.slice(0, 10);

	return since;
};

export type RepoProject = {projectId: string; createdAt: string};

export const readRepoProject = (repoRoot: string): Result<RepoProject> => {
	const projectResult = readProjectFile(repoRoot);
	if (isFail(projectResult)) return failed(projectResult.message);

	return succeeded('Read project', {
		projectId: projectResult.value.projectId,
		createdAt: projectResult.value.createdAt,
	});
};
