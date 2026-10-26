// Joins a ticket's commits (getCommitsForRef) to what their patches say
// (source/lib/stats); the only place that knows both.

import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {deriveIssueStats} from '../lib/stats/issue-stats.js';
import {IssueStats, StatsCommit} from '../lib/stats/issue-stats.model.js';
import {nodeRef, NODE_REF_LENGTH} from '../lib/utils/node-ref.js';
import {resolveClosestEpiqProjectRoot} from '../lib/storage/paths.js';
import {withCommitAuthors} from './api/commit-authors.js';
import {
	CommitEntry,
	getCommitsForRef,
	getCommitsForRefs,
} from '../lib/commits/commits.js';

// Keyed by the shas, whose patches never change, so entries never go stale;
// bounded so a walk over the board doesn't hold every scan.
const CACHE_LIMIT = 32;

const cache = new Map<string, IssueStats>();

// Test-only: module-level state that would otherwise leak between `it()`
// blocks, same reason resetCommitTimelineCacheForTests exists.
export const resetIssueStatsCacheForTests = (): void => {
	cache.clear();
};

const remember = (key: string, stats: IssueStats): IssueStats => {
	cache.set(key, stats);

	// Map iterates in insertion order, so the first key is the oldest.
	if (cache.size > CACHE_LIMIT) {
		const oldest = cache.keys().next();
		if (!oldest.done) cache.delete(oldest.value);
	}

	return stats;
};

// Each commit by the name its author resolves to: `change-shape` counts
// distinct authors by this string, and the Code tab calls one person one author.
const asStatsCommits = <T extends CommitEntry>(
	commits: Result<T[]>,
): Result<StatsCommit[]> => {
	const resolved = withCommitAuthors(commits);
	if (isFail(resolved)) return failed(resolved.message);

	return succeeded(
		'Matched commits by ref',
		resolved.value.map(commit => ({
			sha: commit.sha,
			...(commit.repo ? {repo: commit.repo} : {}),
			time: commit.time,
			author: commit.authorIdentity?.resolved
				? commit.authorIdentity.name
				: commit.author,
			subject: commit.subject,
		})),
	);
};

const projectRoot = (repoRoot?: string): Result<string> => {
	const result = resolveClosestEpiqProjectRoot(repoRoot ?? process.cwd());
	return isFail(result) ? failed(result.message) : result;
};

// The key holds everything the answer depends on; nothing reads the working
// tree or HEAD.
const statsOver = async (
	repoRoot: string,
	label: string,
	commits: StatsCommit[],
): Promise<Result<IssueStats>> => {
	const key = [
		repoRoot,
		label,
		commits.map(commit => `${commit.sha}:${commit.author}`).join(','),
	].join(' ');

	const cached = cache.get(key);
	if (cached) return succeeded('Derived issue stats', cached);

	const statsResult = await deriveIssueStats({repoRoot, ref: label, commits});
	if (isFail(statsResult)) return failed(statsResult.message);

	return succeeded('Derived issue stats', remember(key, statsResult.value));
};

export const getIssueStats = async (
	input: {repoRoot?: string; idOrRef: string; end?: number} = {idOrRef: ''},
): Promise<Result<IssueStats>> => {
	const raw = input.idOrRef.trim();
	if (!raw) return failed('idOrRef must not be empty');

	// A full id is accepted too, like epiq_issue_get: callers hold ids.
	const ref = raw.length > NODE_REF_LENGTH ? nodeRef(raw) : raw.toUpperCase();

	const repoRoot = projectRoot(input.repoRoot);
	if (isFail(repoRoot)) return repoRoot;

	const commits = asStatsCommits(
		await getCommitsForRef({repoRoot: repoRoot.value, ref, end: input.end}),
	);
	if (isFail(commits)) return commits;

	return statsOver(repoRoot.value, ref, commits.value);
};

/** The same stats over every commit of several tickets, each counted once. */
export const getRefsStats = async (input: {
	repoRoot?: string;
	label: string;
	refs: string[];
	end?: number;
}): Promise<Result<IssueStats>> => {
	const repoRoot = projectRoot(input.repoRoot);
	if (isFail(repoRoot)) return repoRoot;

	// The same list the goal's Code tab shows, so the two never disagree.
	const commits = asStatsCommits(
		await getCommitsForRefs({
			repoRoot: repoRoot.value,
			refs: input.refs,
			end: input.end,
		}),
	);
	if (isFail(commits)) return commits;

	return statsOver(repoRoot.value, input.label, commits.value);
};
