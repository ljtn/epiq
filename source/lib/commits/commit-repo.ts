import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {resolveClosestEpiqProjectRoot} from '../storage/paths.js';
import {
	resolveSourceRef as resolveRegistrySourceRef,
	SourceRef,
} from './sources/registry.js';

// How a commit read is addressed: the repository to read from, and — where a
// single commit is named — a sha safe to hand git as an argument.

export type RepoInput = {repoRoot?: string};

// A commit read can name its source: omitted (or `"self"`) reads the board's
// own repository in place; any other id reads a repository registered in
// project.json through epiq's own bare clone of it.
export type SourceInput = RepoInput & {sourceId?: string};

export const resolveRepoRoot = (repoRoot?: string): Result<string> => {
	const result = resolveClosestEpiqProjectRoot(repoRoot ?? process.cwd());
	if (isFail(result)) return failed(result.message);

	return succeeded('Resolved Epiq repo root', result.value);
};

export const resolveSourceRef = (input: SourceInput = {}): Result<SourceRef> =>
	resolveRegistrySourceRef(input);

// `sha` reaches a `git show <sha>` argv slot, where a leading `-` would be read
// as a flag. Argument injection, not shell injection.
export const isPlausibleSha = (sha: string): boolean =>
	/^[0-9a-f]{7,40}$/i.test(sha);
