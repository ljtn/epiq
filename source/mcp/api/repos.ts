// The other repos whose commits count as this board's. Registering one edits
// `project.json`, which is committed like any other file; nothing here writes
// an event. The network is touched only by `fetchRepos`, which a caller runs
// on purpose — the same fetch a sync does.

import {
	describeFetchFailures,
	fetchCommitRepos,
	listRepoStates,
	registerCommitRepo,
	RepoBranches,
	RepoFetchOutcome,
	RepoState,
	resolveRepoRoot,
	unregisterCommitRepo,
} from '../../lib/commits/commits.js';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../../lib/model/result-types.js';

type RepoRootInput = {repoRoot?: string};

export const listRepos = async (
	input: RepoRootInput = {},
): Promise<Result<RepoState[]>> => {
	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	return listRepoStates(repoRootResult.value);
};

export const addRepo = async (
	input: RepoRootInput & {
		url: string;
		branches?: RepoBranches;
		since?: string;
		label?: string;
	},
): Promise<Result<RepoState[]>> => {
	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const addResult = registerCommitRepo({
		repoRoot: repoRootResult.value,
		url: input.url,
		branches: input.branches,
		since: input.since,
		label: input.label,
	});
	if (isFail(addResult)) return failed(addResult.message);

	const listResult = listRepoStates(repoRootResult.value);
	if (isFail(listResult)) return failed(listResult.message);

	return succeeded(addResult.message, listResult.value);
};

export const removeRepo = async (
	input: RepoRootInput & {repo: string},
): Promise<Result<RepoState[]>> => {
	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const removeResult = unregisterCommitRepo({
		repoRoot: repoRootResult.value,
		repo: input.repo,
	});
	if (isFail(removeResult)) return failed(removeResult.message);

	const listResult = listRepoStates(repoRootResult.value);
	if (isFail(listResult)) return failed(listResult.message);

	return succeeded(
		`${removeResult.message}. Commit .epiq/project.json to share it.`,
		listResult.value,
	);
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
