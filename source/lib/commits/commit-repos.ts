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

const SCHEME_URL = /^(https?|ssh|git|file):\/\/[^\s]+$/i;
// `user@host:path`, the form ssh remotes are usually written in.
const SCP_URL = /^[\w.-]+@[\w.-]+:[^\s]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Plain git transports only, and nothing git could read as a flag or a local
 * path. `ext::` would run a command, and a URL arrives from a committed file.
 */
export const isAllowedRepoUrl = (url: string): boolean =>
	!url.startsWith('-') && (SCHEME_URL.test(url) || SCP_URL.test(url));

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
	const slug = last.replace(/[^a-z0-9._-]/g, '-').slice(0, 40);

	return slug.replace(/^[.-]+/, '') || 'repo';
};

export const repoIdOf = (url: string): string =>
	`${labelOf(url)}-${createHash('sha1')
		.update(normalizeUrl(url))
		.digest('hex')
		.slice(0, 8)}`;

/** The label back off an id, which carries it ahead of the URL's hash. */
export const repoLabelOfId = (repoId: string): string =>
	repoId.replace(/-[0-9a-f]{8}$/, '');

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

	for (const entry of entries) {
		const config = parseEntry(entry);
		if (!config) {
			logger.info(
				`[repos] skipped an unreadable entry: ${JSON.stringify(entry)}`,
			);
			continue;
		}

		const repo = toRepo(config);
		if (seen.has(repo.id)) continue;

		seen.add(repo.id);
		repos.push(repo);
	}

	return succeeded('Read other repos', repos);
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

	try {
		fs.writeFileSync(
			getProjectFilePath(repoRoot),
			JSON.stringify(next, null, 2) + '\n',
			'utf8',
		);
	} catch (error) {
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
	if (!isAllowedRepoUrl(url)) {
		return failed(
			`"${url}" is not a remote URL epiq can clone. Use https://, ssh://, git://, file:// or user@host:path.`,
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
export const CLONE_DIR_NAME = /^[a-z0-9._-]+-[0-9a-f]{8}\.git$/;

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
