// Joins the board side to the code side: which commits a ticket owns is a
// question about refs and git history (getCommitsForRef), what those commits
// say about the change is a question about patches (source/lib/stats). This
// file is the seam, and the only place that knows about both.

import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {deriveIssueStats} from '../lib/stats/issue-stats.js';
import {IssueStats, StatsCommit} from '../lib/stats/issue-stats.model.js';
import {nodeRef, NODE_REF_LENGTH} from '../lib/utils/node-ref.js';
import {resolveClosestEpiqProjectRoot} from '../lib/storage/paths.js';
import {withCommitAuthors} from './api/commit-authors.js';
import {getCommitsForRef} from '../lib/commits/commits.js';

// A ticket's shas never change what their patches contain, so the cache is
// keyed by the shas themselves rather than aged out: a new commit on the
// ticket is a new key, and the old entry falls off the end. Bounded because
// walking a board would otherwise keep every ticket's scan alive for the
// lifetime of the server.
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

// The commits a ref owns, each by the name its author resolves to.
const statsCommitsFor = async (
	repoRoot: string,
	ref: string,
	end?: number,
): Promise<Result<StatsCommit[]>> => {
	// Resolved, like every other commit list: `change-shape` counts distinct
	// authors by this string, and the Code tab calls one person one author.
	const commitsResult = withCommitAuthors(
		await getCommitsForRef({repoRoot, ref, end}),
	);
	if (isFail(commitsResult)) return failed(commitsResult.message);

	return succeeded(
		'Matched commits by ref',
		commitsResult.value.map(commit => ({
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

// Everything the answer depends on is in the key: this repo, what is measured,
// the exact commits, and who they resolve to. Nothing here reads the working
// tree or HEAD, so nothing can go stale underneath it.
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

	// A full id is accepted for the same reason epiq_issue_get accepts one:
	// callers hold ids, readers hold refs, and slicing by hand is the mistake
	// the ref field exists to prevent.
	const ref = raw.length > NODE_REF_LENGTH ? nodeRef(raw) : raw.toUpperCase();

	const repoRoot = projectRoot(input.repoRoot);
	if (isFail(repoRoot)) return repoRoot;

	const commits = await statsCommitsFor(repoRoot.value, ref, input.end);
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

	const commits = new Map<string, StatsCommit>();
	for (const ref of input.refs) {
		const owned = await statsCommitsFor(repoRoot.value, ref, input.end);
		if (isFail(owned)) return owned;
		for (const commit of owned.value) {
			commits.set(`${commit.repo ?? ''}:${commit.sha}`, commit);
		}
	}

	return statsOver(
		repoRoot.value,
		input.label,
		// Whole seconds tie often; the key wants one order for one set.
		[...commits.values()].sort(
			(a, b) =>
				b.time - a.time ||
				(a.repo ?? '').localeCompare(b.repo ?? '') ||
				a.sha.localeCompare(b.sha),
		),
	);
};
