// The other repos whose commits count as this board's. Registering one edits
// `project.json`, which is committed like any other file; nothing here writes
// an event. The network is touched only by `fetchRepos`, which a caller runs
// on purpose — the same fetch a sync does.

import {
	fetchCommitRepos,
	invalidateCommitTimelineCache,
	listRepoStates,
	removeCommitRepo,
	removeRepoClone,
	RepoBranches,
	RepoFetchOutcome,
	RepoState,
	resolveRepoRoot,
	upsertCommitRepo,
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
	},
): Promise<Result<RepoState[]>> => {
	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const upsertResult = upsertCommitRepo({
		repoRoot: repoRootResult.value,
		url: input.url,
		branches: input.branches,
		since: input.since,
	});
	if (isFail(upsertResult)) return failed(upsertResult.message);

	const listResult = listRepoStates(repoRootResult.value);
	if (isFail(listResult)) return failed(listResult.message);

	return succeeded(
		`${upsertResult.message}. Commit .epiq/project.json to share it; it is fetched on the next sync.`,
		listResult.value,
	);
};

export const removeRepo = async (
	input: RepoRootInput & {repo: string},
): Promise<Result<RepoState[]>> => {
	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const removeResult = removeCommitRepo({
		repoRoot: repoRootResult.value,
		repo: input.repo,
	});
	if (isFail(removeResult)) return failed(removeResult.message);

	// The registration is what counts; a clone that could not be deleted now
	// is only disk, and the next remove or a manual delete takes it.
	removeRepoClone({
		repoRoot: repoRootResult.value,
		repoId: removeResult.value.id,
	});
	invalidateCommitTimelineCache();

	const listResult = listRepoStates(repoRootResult.value);
	if (isFail(listResult)) return failed(listResult.message);

	return succeeded(
		`${removeResult.message}. Commit .epiq/project.json to share it.`,
		listResult.value,
	);
};

/** Clones what is missing and fetches the rest, without syncing the board. */
export const fetchRepos = async (
	input: RepoRootInput = {},
): Promise<Result<RepoFetchOutcome[]>> => {
	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	return fetchCommitRepos({repoRoot: repoRootResult.value});
};
