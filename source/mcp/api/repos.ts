// The other repos whose commits count as this board's, kept as board events
// so they sync like any other change. Connecting one is two calls: the first
// clones it into a stage and previews it, writing nothing; the second, with
// `confirm`, writes the event. The network is touched by that preview and by
// `fetchRepos`, which a caller runs on purpose.

import {
	cancelRepoPreview,
	claimedBytesOf,
	connectCommitRepo,
	describeFetchFailures,
	disconnectCommitRepo,
	fetchCommitRepos,
	listRepoStates,
	MAX_REPOS,
	RepoBranches,
	RepoFetchOutcome,
	RepoPreview,
	repoIdOf,
	RepoState,
	resolveRepoRoot,
} from '../../lib/commits/commits.js';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../../lib/model/result-types.js';
import {bootedWithActorAndState} from './boot.js';

type RepoRootInput = {repoRoot?: string};

export type RepoList = {
	repos: RepoState[];
	claimedBytes: number;
	/** How many repos the board reads; the rest are listed, never fetched. */
	limit: number;
};

const listed = (repoRoot: string): Result<RepoList> => {
	const listResult = listRepoStates(repoRoot);
	if (isFail(listResult)) return failed(listResult.message);

	return succeeded('Listed repos', {
		repos: listResult.value,
		claimedBytes: claimedBytesOf(repoRoot),
		limit: MAX_REPOS,
	});
};

export const listRepos = async (
	input: RepoRootInput = {},
): Promise<Result<RepoList>> => {
	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	return listed(repoRootResult.value);
};

export const connectRepo = async (
	input: RepoRootInput & {
		url: string;
		branches?: RepoBranches;
		since?: string;
		label?: string;
		confirm?: boolean;
		/** Stage and preview only: never writes, and never holds a write lock. */
		previewOnly?: boolean;
	},
): Promise<Result<RepoList & {preview?: RepoPreview}>> => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;
	const {repoRoot} = ready.value.boot;

	const result = await connectCommitRepo({
		repoRoot,
		actorId: ready.value.actor.userId,
		url: input.url,
		branches: input.branches,
		since: input.since,
		label: input.label,
		mode: input.previewOnly ? 'preview' : input.confirm ? 'confirm' : 'auto',
	});
	if (isFail(result)) return failed(result.message);

	const listResult = listed(repoRoot);
	if (isFail(listResult)) return failed(listResult.message);

	return succeeded(result.message, {
		...listResult.value,
		...(result.value.kind === 'preview' ? {preview: result.value.preview} : {}),
	});
};

export const disconnectRepo = async (
	input: RepoRootInput & {repo: string},
): Promise<Result<RepoList>> => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;
	const {repoRoot} = ready.value.boot;

	const result = disconnectCommitRepo({
		repoRoot,
		actorId: ready.value.actor.userId,
		repo: input.repo,
	});
	if (isFail(result)) return failed(result.message);

	const listResult = listed(repoRoot);
	if (isFail(listResult)) return failed(listResult.message);

	return succeeded(result.message, listResult.value);
};

/** Abandons a preview: its staged clone is deleted. */
export const cancelRepoConnect = (
	input: {repo: string} | {url: string},
): Result<null> => {
	cancelRepoPreview('repo' in input ? input.repo : repoIdOf(input.url.trim()));
	return succeeded('Cancelled', null);
};

/**
 * A board sync's answer, with the other repos fetched after it — outside the
 * lock the sync was run under, which the caller has already let go of.
 */
export const syncThenFetchRepos = async <T extends object>(
	syncResult: Result<T>,
	input: RepoRootInput = {},
	// Past this the answer goes back without them: a first clone can outlast
	// a client's request timeout, and the board itself has already synced.
	budgetMs = 20_000,
): Promise<Result<T & {repos?: RepoFetchOutcome[]}>> => {
	if (isFail(syncResult)) return syncResult;

	let timer: NodeJS.Timeout | undefined;
	const reposResult = await Promise.race([
		fetchRepos(input),
		new Promise<null>(resolve => {
			timer = setTimeout(() => resolve(null), budgetMs);
		}),
	]);
	clearTimeout(timer);

	if (reposResult === null) {
		return succeeded(
			`${syncResult.message} · still fetching other repos; epiq_repo_list shows how they stand`,
			syncResult.value,
		);
	}

	if (isFail(reposResult) || reposResult.value.length === 0) {
		return syncResult;
	}

	return succeeded(
		[syncResult.message, describeFetchFailures(reposResult.value)]
			.filter(Boolean)
			.join(' · '),
		{...syncResult.value, repos: reposResult.value},
	);
};

/** Clones what is missing and fetches the rest, without syncing the board. */
export const fetchRepos = async (
	input: RepoRootInput & {minIntervalMs?: number} = {},
): Promise<Result<RepoFetchOutcome[]>> => {
	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	return fetchCommitRepos({
		repoRoot: repoRootResult.value,
		minIntervalMs: input.minIntervalMs,
	});
};
