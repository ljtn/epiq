// Joins the board side to the code side: which commits a ticket owns is a
// question about refs and git history (getCommitsForRef), what those commits
// say about the change is a question about patches (source/lib/stats). This
// file is the seam, and the only place that knows about both.

import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {deriveIssueStats} from '../lib/stats/issue-stats.js';
import {IssueStats, StatsCommit} from '../lib/stats/issue-stats.model.js';
import {nodeRef, NODE_REF_LENGTH} from '../lib/utils/node-ref.js';
import {resolveClosestEpiqProjectRoot} from '../lib/storage/paths.js';
import {getCommitsForRef} from './epiq-time-travel.js';

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

export const getIssueStats = async (
	input: {repoRoot?: string; idOrRef: string} = {idOrRef: ''},
): Promise<Result<IssueStats>> => {
	const raw = input.idOrRef.trim();
	if (!raw) return failed('idOrRef must not be empty');

	// A full id is accepted for the same reason epiq_issue_get accepts one:
	// callers hold ids, readers hold refs, and slicing by hand is the mistake
	// the ref field exists to prevent.
	const ref = raw.length > NODE_REF_LENGTH ? nodeRef(raw) : raw.toUpperCase();

	const repoRootResult = resolveClosestEpiqProjectRoot(
		input.repoRoot ?? process.cwd(),
	);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);
	const repoRoot = repoRootResult.value;

	const commitsResult = await getCommitsForRef({repoRoot, ref});
	if (isFail(commitsResult)) return failed(commitsResult.message);

	const commits: StatsCommit[] = commitsResult.value.map(commit => ({
		sha: commit.sha,
		time: commit.time,
		author: commit.author,
		subject: commit.subject,
	}));

	// Everything the answer depends on is in the key: this repo, this ticket,
	// and the exact commits it owns. Nothing here reads the working tree or
	// HEAD any more, so nothing can go stale underneath it.
	const key = [repoRoot, ref, commits.map(commit => commit.sha).join(',')].join(
		' ',
	);

	const cached = cache.get(key);
	if (cached) return succeeded('Derived issue stats', cached);

	const statsResult = await deriveIssueStats({repoRoot, ref, commits});
	if (isFail(statsResult)) return failed(statsResult.message);

	return succeeded('Derived issue stats', remember(key, statsResult.value));
};
