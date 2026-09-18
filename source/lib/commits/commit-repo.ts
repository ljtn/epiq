import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {resolveClosestEpiqProjectRoot} from '../storage/paths.js';

// How a commit read is addressed: the repository to read from, and — where a
// single commit is named — a sha safe to hand git as an argument.

export type RepoInput = {repoRoot?: string};

export const resolveRepoRoot = (repoRoot?: string): Result<string> => {
	const result = resolveClosestEpiqProjectRoot(repoRoot ?? process.cwd());
	if (isFail(result)) return failed(result.message);

	return succeeded('Resolved Epiq repo root', result.value);
};

// `sha` reaches a `git show <sha>` argv slot, where a leading `-` would be read
// as a flag. Argument injection, not shell injection.
export const isPlausibleSha = (sha: string): boolean =>
	/^[0-9a-f]{7,40}$/i.test(sha);
