import {
	invalidateCommitTimelineCache,
	isAllowedRepoUrl,
	isRepoSince,
	readCommitRepos,
	removeCommitRepo,
	removeRepoClone,
	RepoBranches,
	repoIdOf,
	resolveRepoRoot,
	upsertCommitRepo,
	type CommitRepo,
} from '../../commits/commits.js';
import {failed, isFail, Result, succeeded} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';

// `:config repoAdd <url> [branches=default|all] [since=board|all|YYYY-MM-DD]`
// and `:config repoRemove <name>`: the TUI's way to the repos the GUI's palette
// opens. Both edit `.epiq/project.json`; the next sync fetches.

export type RepoAddArgs = {
	url: string;
	branches?: RepoBranches;
	since?: string;
};

export const REPO_ADD_OPTIONS = [
	'branches=default',
	'branches=all',
	'since=board',
	'since=all',
];

/** The typed line as a request, or why it is not one yet. */
export const parseRepoAddArgs = (input: string): Result<RepoAddArgs> => {
	const [url = '', ...options] = input.trim().split(/\s+/).filter(Boolean);
	if (!url) return failed('a remote URL to read commits from');
	if (!isAllowedRepoUrl(url)) {
		return failed('https://, ssh://, git://, file:// or user@host:path');
	}

	const args: RepoAddArgs = {url};

	for (const option of options) {
		const [key, value = ''] = option.split('=');

		if (key === 'branches' && (value === 'default' || value === 'all')) {
			args.branches = value;
		} else if (key === 'since' && isRepoSince(value)) {
			args.since = value;
		} else {
			return failed(
				`"${option}" is not an option: ${REPO_ADD_OPTIONS.join(', ')}`,
			);
		}
	}

	return succeeded('Parsed', args);
};

/** The registered repos, for `repoRemove`'s completion and its lookup. */
export const registeredRepos = (): CommitRepo[] => {
	const repoRootResult = resolveRepoRoot();
	if (isFail(repoRootResult)) return [];

	const reposResult = readCommitRepos(repoRootResult.value);
	return isFail(reposResult) ? [] : reposResult.value;
};

export const repoAddCommand = () => {
	const argsResult = parseRepoAddArgs(getCmdState().commandMeta.inputString);
	if (isFail(argsResult)) return failed(`Expected ${argsResult.message}`);

	const repoRootResult = resolveRepoRoot();
	if (isFail(repoRootResult)) return repoRootResult;

	const result = upsertCommitRepo({
		repoRoot: repoRootResult.value,
		...argsResult.value,
	});
	if (isFail(result)) return result;

	invalidateCommitTimelineCache();

	return succeeded(
		`${result.message} — commit .epiq/project.json to share it; :sync fetches it`,
		null,
	);
};

/** The names a repo can be removed by: its label where that is unique, else its id. */
export const removableNames = (repos: CommitRepo[]): string[] =>
	repos.map(repo =>
		repos.filter(other => other.label === repo.label).length === 1
			? repo.label
			: repo.id,
	);

/** The id a typed name stands for: a unique label, an id, or a URL. */
export const resolveRemoveTarget = (
	repos: CommitRepo[],
	typed: string,
): Result<string> => {
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
		? succeeded('Resolved', match.id)
		: failed(`No repo "${typed}" is registered`);
};

export const repoRemoveCommand = () => {
	const typed = getCmdState().commandMeta.inputString.trim();

	const repoRootResult = resolveRepoRoot();
	if (isFail(repoRootResult)) return repoRootResult;

	const repoResult = resolveRemoveTarget(registeredRepos(), typed);
	if (isFail(repoResult)) return repoResult;
	const target = repoResult.value;

	const result = removeCommitRepo({
		repoRoot: repoRootResult.value,
		repo: target,
	});
	if (isFail(result)) return result;

	removeRepoClone({repoRoot: repoRootResult.value, repoId: result.value.id});
	invalidateCommitTimelineCache();

	return succeeded(
		`${result.message} — commit .epiq/project.json to share it`,
		null,
	);
};
