import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {logger} from '../../logger.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {readProjectFile} from '../project-setup/project-setup.js';
import {getGlobalConfigDir} from '../storage/global-config-dir.js';
import {getProjectFilePath} from '../storage/paths.js';

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
};

export type CommitRepo = CommitRepoConfig & {
	/** Stable across machines: derived from the URL alone. */
	id: string;
	label: string;
};

export const REPOS_KEY = 'repos';

const SCHEMES = new Set(['https:', 'http:', 'ssh:', 'git:', 'file:']);
// `user@host:path`, the form ssh remotes are usually written in. Both names
// open on a letter or digit: one opening on `-` reaches ssh as an option.
const SCP_URL = /^[A-Za-z0-9][\w.-]*@[A-Za-z0-9][\w.-]*:[^:]+$/;
// Visible ASCII: no spaces, no control characters to rewrite a terminal with,
// no lookalike letters to pass one host off as another.
const PRINTABLE = /^[\x21-\x7e]+$/;
const MAX_URL_LENGTH = 2048;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Why a URL may not be registered, or null when it may. It arrives from a
 * committed file, so it is anybody's who can open a pull request: plain git
 * transports only, nothing git could read as a flag, nothing that runs a
 * command (`ext::` or any other `<helper>::` remote), a local path only as an
 * explicit `file:///`, and no password — one in a committed URL is a leaked
 * one, and a credential helper is where it belongs.
 */
export const repoUrlProblem = (url: string): string | null => {
	if (url.length > MAX_URL_LENGTH) return 'is too long';
	if (!PRINTABLE.test(url)) return 'holds spaces or characters git would not';
	if (url.startsWith('-')) return 'would be read as an option';
	// `<transport>::<address>` hands the address to `git remote-<transport>`.
	if (url.includes('::')) return 'names a remote helper';
	if (SCP_URL.test(url)) return null;

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return 'is not a remote URL';
	}

	if (!SCHEMES.has(parsed.protocol)) {
		return 'uses a transport epiq does not clone over';
	}
	if (parsed.password) return 'carries a password — use a credential helper';
	// Over ssh the user is the login; anywhere else it is only a way to make
	// one host read as another (`https://github.com@evil.example/…`).
	if (parsed.username && parsed.protocol !== 'ssh:') {
		return 'names a user before the host — leave it to a credential helper';
	}

	if (parsed.protocol === 'file:') {
		// A file URL naming another machine is read by some platforms as a
		// network share.
		if (parsed.hostname) return 'names a host in a file:// URL';
		// `file:x` is not a file URL to git: it reads as ssh to a host `file`.
		return url.startsWith('file:///') ? null : 'is not a file:/// URL';
	}

	if (!parsed.hostname) return 'names no host';
	if (parsed.hostname.startsWith('-') || parsed.username.startsWith('-')) {
		return 'would be read as an option';
	}

	return null;
};

export const isAllowedRepoUrl = (url: string): boolean =>
	repoUrlProblem(url) === null;

/**
 * How many repos one board reads. The list is a committed file; past this, a
 * hostile one is asking for a clone of everything, not describing a project.
 */
export const MAX_REPOS = 20;

export const isRepoSince = (value: string): boolean =>
	value === 'board' ||
	value === 'all' ||
	(DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));

const normalizeUrl = (url: string): string =>
	url
		.trim()
		.replace(/\/+$/, '')
		.replace(/\.git$/i, '')
		.toLowerCase();

const labelOf = (url: string): string => {
	const last = normalizeUrl(url).split(/[/:]/).filter(Boolean).pop() ?? '';
	// Short: it names a directory, and Windows caps a whole path at 260.
	const slug = last.replace(/[^a-z0-9._-]/g, '-').slice(0, 24);

	return slug.replace(/^[.-]+/, '') || 'repo';
};

export const repoIdOf = (url: string): string =>
	`${labelOf(url)}-${createHash('sha1')
		.update(normalizeUrl(url))
		.digest('hex')
		.slice(0, 12)}`;

/** The label back off an id, which carries it ahead of the URL's hash. */
export const repoLabelOfId = (repoId: string): string =>
	repoId.replace(/-[0-9a-f]{12}$/, '');

const toRepo = (config: CommitRepoConfig): CommitRepo => ({
	...config,
	id: repoIdOf(config.url),
	label: labelOf(config.url),
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

	return {url, branches, since};
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
	const rawResult = readRawProject(repoRoot);
	if (isFail(rawResult)) return failed(rawResult.message);

	const entries = edit(readRawEntries(rawResult.value));
	const next: Record<string, unknown> = {...rawResult.value};
	if (entries.length === 0) {
		delete next[REPOS_KEY];
	} else {
		next[REPOS_KEY] = entries;
	}

	const targetResult = writableProjectFile(repoRoot);
	if (isFail(targetResult)) return failed(targetResult.message);
	const target = targetResult.value;
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

/** Adds a repo, or changes the options of one already listed. */
export const upsertCommitRepo = (input: {
	repoRoot: string;
	url: string;
	branches?: RepoBranches;
	since?: RepoSince;
}): Result<CommitRepo> => {
	const url = input.url.trim();
	const problem = repoUrlProblem(url);
	if (problem) {
		return failed(
			`That URL ${problem}. Use https://, ssh://, git://, file:// or user@host:path.`,
		);
	}
	if (input.since !== undefined && !isRepoSince(input.since)) {
		return failed(
			`"${input.since}" is not a history window: use board, all or YYYY-MM-DD.`,
		);
	}

	const reposResult = readCommitRepos(input.repoRoot);
	if (isFail(reposResult)) return failed(reposResult.message);

	const id = repoIdOf(url);
	const existing = reposResult.value.find(repo => repo.id === id);

	const config: CommitRepoConfig = {
		url: existing?.url ?? url,
		branches: input.branches ?? existing?.branches ?? 'default',
		since: input.since ?? existing?.since ?? 'board',
	};

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

		return entries.map((entry, at) =>
			at === index ? {...kept, ...config} : entry,
		);
	});
	if (isFail(writeResult)) return failed(writeResult.message);

	return succeeded(
		existing
			? `Updated ${toRepo(config).label}`
			: `Added ${toRepo(config).label}`,
		toRepo(config),
	);
};

export const removeCommitRepo = (input: {
	repoRoot: string;
	/** The repo's id, or its URL as written. */
	repo: string;
}): Result<CommitRepo> => {
	const reposResult = readCommitRepos(input.repoRoot);
	if (isFail(reposResult)) return failed(reposResult.message);

	const target = input.repo.trim();
	const match = reposResult.value.find(
		repo =>
			repo.id === target ||
			(isAllowedRepoUrl(target) && repo.id === repoIdOf(target)),
	);
	if (!match) return failed(`No repo "${target}" is registered`);

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
