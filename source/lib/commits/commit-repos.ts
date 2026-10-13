import {createHash} from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import {ulid} from 'ulid';
import {getStateBranchRoot} from '../../git/git-storage.js';
import {logger} from '../../logger.js';
import {accountedSignature, logSignature} from '../event/log-signature.js';
import {
	loadMergedEvents,
	materializeAndPersistAll,
} from '../board/board-log.js';
import {
	FOLD_DEFAULT_BRANCHES,
	FOLD_DEFAULT_SINCE,
	foldRepoEvents,
	isRepoLabel,
	isRepoSince,
	repoIdOf,
	repoLabelOfUrl,
	resolveRepos,
	type CommitRepo,
	type RepoBranches,
	type RepoRegistry,
	type RepoSince,
	type ResolvedRepos,
} from '../board/board-repos.js';
import {AppEvent} from '../board/board-events.model.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {readProjectFile} from '../project-setup/project-setup.js';
import {getState, isStateInitialized} from '../state/state.js';
import {getGlobalConfigDir} from '../storage/global-config-dir.js';
import {isAllowedRepoUrl, repoUrlProblem, REPO_URL_FORMS} from './repo-url.js';

export {isAllowedRepoUrl, repoUrlProblem} from './repo-url.js';
export {
	isRepoLabel,
	isRepoSince,
	MAX_REPOS,
	repoIdOf,
	repoLabelOfId,
	repoLabelOfUrl,
	type CommitRepo,
	type RepoBranches,
	type RepoSince,
	type ResolvedRepos,
} from '../board/board-repos.js';

// Other repositories whose commits count as this board's. They are board
// events (see `board-repos.ts`), so they sync with the board and can never
// conflict; this is where the rest of epiq reads and writes them.
//
// Read from the whole live log rather than the board state, which a time
// travel checkout rewinds: the repos a board reads are the ones it reads now.

/** The answer to a connect that names a repo already connected just so. */
export const REPO_UNCHANGED = 'Unchanged';
/** How the answer to a change of label alone opens: no commit moved. */
export const REPO_RENAMED = 'Renamed ';

const EMPTY: ResolvedRepos = {live: [], overLimit: [], disconnected: []};

let cached: {root: string; signature: string; repos: ResolvedRepos} | null =
	null;

// The board state is the same fold when it is live and has accounted for
// every line on disk; it is not while a checkout or a replay holds it.
const liveRegistry = (root: string, signature: string): RepoRegistry | null => {
	if (!isStateInitialized()) return null;

	const state = getState();
	return state.timeMode === 'live' &&
		state.replay === null &&
		accountedSignature(root) === signature
		? state.repos
		: null;
};

/**
 * The connected repos as the whole log has them, on every call: another
 * process's write shows on the next read. Never throws; a log that cannot be
 * read is a failure the caller must not take for "no repos".
 */
export const readConnectedRepos = (repoRoot: string): Result<ResolvedRepos> => {
	try {
		const rootResult = getStateBranchRoot({repoRoot});
		if (isFail(rootResult)) return failed(rootResult.message);
		const root = rootResult.value;

		// Before the log: a line written between the two is then read again on
		// the next call, never missed.
		const signature = logSignature(root);
		if (signature === 'none') return succeeded('No log yet', EMPTY);
		if (cached && cached.root === root && cached.signature === signature) {
			return succeeded('Read connected repos', cached.repos);
		}

		let registry = liveRegistry(root, signature);
		if (!registry) {
			const eventsResult = loadMergedEvents(root);
			if (isFail(eventsResult)) return failed(eventsResult.message);
			registry = foldRepoEvents(eventsResult.value);
		}

		const repos = resolveRepos(registry);
		cached = {root, signature, repos};

		return succeeded('Read connected repos', repos);
	} catch (error) {
		const message = `Could not read the connected repos: ${
			error instanceof Error ? error.message : String(error)
		}`;
		logger.info(`[repos] ${message}`);
		return failed(message);
	}
};

/** The repos the board reads, or none where the log cannot be read. */
export const readCommitRepos = (repoRoot: string): Result<CommitRepo[]> => {
	const result = readConnectedRepos(repoRoot);
	return isFail(result)
		? failed(result.message)
		: succeeded('Read other repos', result.value.live);
};

/** Whether the repo is still read: asked of the log, never cached past a write. */
export const isRepoListed = (repoRoot: string, repoId: string): boolean => {
	const repos = readCommitRepos(repoRoot);
	return !isFail(repos) && repos.value.some(repo => repo.id === repoId);
};

export type RepoChange = {
	repoRoot: string;
	url: string;
	branches?: RepoBranches;
	since?: RepoSince;
	/** What to call it; empty goes back to the URL's basename. */
	label?: string;
};

/**
 * What a connect comes to, before anything is written: a new repo (which
 * needs a pre-flight and a confirm), a change to a connected one, or nothing.
 * Checked against the list as this machine has it; a pull can still put an
 * earlier connect ahead of it, which readers settle.
 */
export type RepoPlan =
	| {
			kind: 'connect';
			repo: CommitRepo;
			event: AppEvent<'connect.repo'>['payload'];
	  }
	| {
			kind: 'edit';
			repo: CommitRepo;
			event: AppEvent<'edit.repo'>['payload'];
			message: string;
	  }
	| {kind: 'unchanged'; repo: CommitRepo};

export const planRepoChange = (input: RepoChange): Result<RepoPlan> => {
	const url = input.url.trim();
	const problem = repoUrlProblem(url);
	if (problem) return failed(`That URL ${problem}. ${REPO_URL_FORMS}`);

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

	const reposResult = readConnectedRepos(input.repoRoot);
	if (isFail(reposResult)) return failed(reposResult.message);
	const listed = [...reposResult.value.live, ...reposResult.value.overLimit];

	const id = repoIdOf(url);
	const existing = listed.find(repo => repo.id === id);

	// Empty, or the basename itself, means no label of its own.
	const label =
		typedLabel === undefined
			? undefined
			: typedLabel === repoLabelOfUrl(existing?.url ?? url)
			? ''
			: typedLabel;

	// Telling two repos apart is what a label is for. A derived one is never
	// refused: two forks share a basename before anybody names one.
	if (label && listed.some(repo => repo.id !== id && repo.label === label)) {
		return failed(`Another repo is already called ${label}`);
	}

	// Only what was said: a connect racing an edit then leaves the edit's
	// fields alone.
	const fields = {
		...(input.branches ? {branches: input.branches} : {}),
		...(input.since ? {since: input.since} : {}),
		...(label !== undefined ? {label} : {}),
	};

	if (!existing) {
		const repo: CommitRepo = {
			id,
			url,
			branches: input.branches ?? FOLD_DEFAULT_BRANCHES,
			since: input.since ?? FOLD_DEFAULT_SINCE,
			label: label || repoLabelOfUrl(url),
		};
		return succeeded('Plan', {
			kind: 'connect',
			repo,
			event: {
				url,
				...(input.branches ? {branches: input.branches} : {}),
				...(input.since ? {since: input.since} : {}),
				...(label ? {label} : {}),
			},
		});
	}

	const next: CommitRepo = {
		...existing,
		branches: input.branches ?? existing.branches,
		since: input.since ?? existing.since,
		label:
			label === undefined
				? existing.label
				: label || repoLabelOfUrl(existing.url),
	};

	if (
		next.branches === existing.branches &&
		next.since === existing.since &&
		next.label === existing.label
	) {
		return succeeded('Plan', {kind: 'unchanged', repo: existing});
	}

	const renamed =
		next.branches === existing.branches && next.since === existing.since;

	return succeeded('Plan', {
		kind: 'edit',
		repo: next,
		event: {repo: id, ...fields},
		message: `${renamed ? REPO_RENAMED : 'Updated '}${next.label}`,
	});
};

/** Appends one repo event as `actorId`. The board state must be booted. */
export const writeRepoEvent = (input: {
	repoRoot: string;
	actorId: string;
	event:
		| {action: 'connect.repo'; payload: AppEvent<'connect.repo'>['payload']}
		| {action: 'edit.repo'; payload: AppEvent<'edit.repo'>['payload']}
		| {
				action: 'disconnect.repo';
				payload: AppEvent<'disconnect.repo'>['payload'];
		  };
}): Result<null> => {
	const rootResult = getStateBranchRoot({repoRoot: input.repoRoot});
	if (isFail(rootResult)) return failed(rootResult.message);

	const written = materializeAndPersistAll(
		[{id: ulid(), userId: input.actorId, ...input.event} as AppEvent],
		rootResult.value,
	);

	return isFail(written)
		? failed(written.message)
		: succeeded('Wrote repo event', null);
};

/** The registered repos' labels by id, for a reader that holds only ids. */
export const repoLabelsById = (
	repoRoot: string,
): ReadonlyMap<string, string> => {
	const reposResult = readConnectedRepos(repoRoot);

	return new Map(
		isFail(reposResult)
			? []
			: [...reposResult.value.live, ...reposResult.value.overLimit].map(
					repo => [repo.id, repo.label],
			  ),
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
		: failed(`No repo "${typed}" is connected`);
};

/** The connected repo a name stands for, past the cap included. */
export const findConnectedRepo = (
	repoRoot: string,
	name: string,
): Result<CommitRepo> => {
	const reposResult = readConnectedRepos(repoRoot);
	if (isFail(reposResult)) return failed(reposResult.message);

	return findCommitRepo(
		[...reposResult.value.live, ...reposResult.value.overLimit],
		name,
	);
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
 * connected repo that is an epiq board keeps its event log there, not its work.
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
