import {
	isAllowedRepoUrl,
	isRepoLabel,
	isRepoSince,
	readCommitRepos,
	registerCommitRepo,
	RepoBranches,
	resolveRepoRoot,
	unregisterCommitRepo,
	type CommitRepo,
} from '../../commits/commits.js';
import {REPO_RENAMED, REPO_UNCHANGED} from '../../commits/commit-repos.js';
import {failed, isFail, Result, succeeded} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';

// `:config repoAdd <url> [branches=default|all] [since=board|all|YYYY-MM-DD]
// [label=<name>]` and `:config repoRemove <name>`: the TUI's way to the repos
// the GUI's palette opens. Both edit `.epiq/project.json`; the next sync
// fetches.

export type RepoAddArgs = {
	url: string;
	branches?: RepoBranches;
	since?: string;
	label?: string;
};

export const REPO_ADD_OPTIONS = [
	'branches=default',
	'branches=all',
	'since=board',
	'since=all',
	'since=YYYY-MM-DD',
	'label=<name>',
];

/** The typed line as a request, or why it is not one yet. */
export const parseRepoAddArgs = (input: string): Result<RepoAddArgs> => {
	const [url = '', ...options] = input.trim().split(/\s+/).filter(Boolean);
	if (!url) return failed('a remote URL to read commits from');
	if (!isAllowedRepoUrl(url)) {
		return failed('https://, ssh://, git://, file:/// or user@host:path');
	}

	const args: RepoAddArgs = {url};
	const seen = new Set<string>();

	for (const option of options) {
		// At the first `=` only: a label may carry one.
		const split = option.indexOf('=');
		const key = split === -1 ? option : option.slice(0, split);
		const value = split === -1 ? '' : option.slice(split + 1);

		if (seen.has(key)) return failed(`one ${key}=, not two`);
		seen.add(key);

		if (key === 'branches' && (value === 'default' || value === 'all')) {
			args.branches = value;
		} else if (key === 'since' && isRepoSince(value)) {
			args.since = value;
		} else if (key === 'label' && (value === '' || isRepoLabel(value))) {
			// `label=` alone goes back to the URL's basename.
			args.label = value;
		} else {
			// Read after `Expected`, as every refusal here is.
			return failed(`${REPO_ADD_OPTIONS.join(', ')}; not "${option}"`);
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

	const result = registerCommitRepo({
		repoRoot: repoRootResult.value,
		...argsResult.value,
	});
	if (isFail(result)) return result;

	// The hint only where something was written and is to be fetched.
	return succeeded(
		result.message === REPO_UNCHANGED || result.message.startsWith(REPO_RENAMED)
			? result.message
			: `${result.message} — commit .epiq/project.json to share it; :sync fetches it`,
		null,
	);
};

export const repoRemoveCommand = () => {
	const repoRootResult = resolveRepoRoot();
	if (isFail(repoRootResult)) return repoRootResult;

	const result = unregisterCommitRepo({
		repoRoot: repoRootResult.value,
		repo: getCmdState().commandMeta.inputString,
	});
	if (isFail(result)) return result;

	return succeeded(
		`${result.message} — commit .epiq/project.json to share it`,
		null,
	);
};
