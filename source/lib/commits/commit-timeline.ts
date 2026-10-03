import {execGit} from '../../git/git-utils.js';
import {logger} from '../../logger.js';
import {CommitAuthor} from '../repository/contributor-directory.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {scanCacheMs} from '../utils/cache-ttl.js';
import {NODE_REF_LENGTH} from '../utils/node-ref.js';
import {RepoInput} from './commit-repo.js';
import {CommitSource, listCommitSources} from './commit-sources.js';

export type CommitEntry = {
	sha: string;
	/**
	 * The registered repo this commit was read from, by id. Absent for the
	 * board's own repo, which is how every commit looked before there were
	 * other repos.
	 */
	repo?: string;
	time: number;
	author: string;
	/**
	 * The author's git address, which is what a contributor is matched on. The
	 * name beside it is free text and two people can share one, so it is for
	 * showing, never for matching.
	 */
	authorEmail: string;
	/**
	 * Who the author is on this board, filled in by `withCommitAuthors` once
	 * state is available. Absent here because reading it is not a pure function
	 * of the repository, and this type is produced by one.
	 */
	authorIdentity?: CommitAuthor;
	subject: string;
	linesChanged: number;
	insertions: number;
	deletions: number;
};

// Non-printable, so a commit subject can never contain them.
const GIT_LOG_FIELD_SEP = '\x1f';
const GIT_LOG_RECORD_SEP = '\x1e';

// The full (unwindowed) scan is the one both the scrubber ('All' scope) and
// getCommitsForRef ask for, typically moments apart over the same history —
// short-lived since nothing here invalidates it on a new commit landing, just
// long enough to cover "the Commits tab opens right after the scrubber loads".
export const FULL_TIMELINE_CACHE_TTL_MS = 5_000;

// Per source, keyed by where it is read and what is walked.
const fullTimelineCache = new Map<
	string,
	{fetchedAt: number; result: CommitEntry[]}
>();

// Test-only: the cache is module-level state, so it would otherwise leak
// between `it()` blocks in the same file (unlike vi.clearAllMocks(), which
// only resets mock call state, not arbitrary module variables).
export const resetCommitTimelineCacheForTests = (): void => {
	fullTimelineCache.clear();
};

/** After a fetch: a clone's history has moved, so its cached read is stale. */
export const invalidateCommitTimelineCache = (): void => {
	fullTimelineCache.clear();
};

// Whether a commit belongs to the window it was fetched for. `--since`/`--until`
// match on the committer date, but a commit is plotted at its author date, and a
// rebase moves the two days apart; left in, such a commit stretches the axis to
// reach it.
//
// The start is compared at its own second, which is all a commit time has: a
// window opening mid-second would otherwise drop a commit made in that same
// second — the second git itself was asked for. A ticket's window opens at the
// moment the ticket was created, so the commit this loses is its very first.
export const inCommitWindow = (
	time: number,
	start: number | undefined,
	end: number | undefined,
): boolean =>
	(start === undefined || time >= Math.floor(start / 1000) * 1000) &&
	(end === undefined || time <= end);

type Window = {start?: number; end?: number};

const readSourceLog = async (
	source: CommitSource,
	window: Window,
): Promise<Result<CommitEntry[]>> => {
	// Only the unwindowed call is cached — it is the expensive, frequently-
	// repeated one (a full `--shortstat` scan of the whole history); a
	// start/end-scoped scrub is comparatively cheap and varies request to
	// request, so caching it would mostly just grow a cache no one re-hits.
	const cacheable = window.start === undefined && window.end === undefined;
	const cacheKey = `${source.cwd}\0${source.revisions.join(' ')}`;
	const cached = cacheable ? fullTimelineCache.get(cacheKey) : undefined;

	if (
		cached &&
		Date.now() - cached.fetchedAt < scanCacheMs(FULL_TIMELINE_CACHE_TTL_MS)
	) {
		return succeeded('Computed commit timeline', cached.result);
	}

	const logResult = await execGit({
		cwd: source.cwd,
		args: [
			'log',
			...source.revisions,
			...(window.start !== undefined
				? [`--since=@${Math.floor(window.start / 1000)}`]
				: []),
			...(window.end !== undefined
				? [`--until=@${Math.floor(window.end / 1000)}`]
				: []),
			'--shortstat',
			`--format=${GIT_LOG_RECORD_SEP}%H${GIT_LOG_FIELD_SEP}%at${GIT_LOG_FIELD_SEP}%an${GIT_LOG_FIELD_SEP}%ae${GIT_LOG_FIELD_SEP}%s`,
		],
	});

	if (isFail(logResult)) return failed(logResult.message);

	const commits = logResult.value.stdout
		.split(GIT_LOG_RECORD_SEP)
		.filter(record => record.trim().length > 0)
		.map((record): CommitEntry | null => {
			const [headerLine, ...statLines] = record.split('\n');
			const [sha, atSeconds, author, authorEmail, ...subjectParts] = (
				headerLine ?? ''
			).split(GIT_LOG_FIELD_SEP);
			if (!sha || !atSeconds) return null;
			if (source.exclude.has(sha)) return null;

			const statText = statLines.join(' ');
			const insertions = Number(/(\d+) insertion/.exec(statText)?.[1] ?? 0);
			const deletions = Number(/(\d+) deletion/.exec(statText)?.[1] ?? 0);

			return {
				sha,
				...(source.repo ? {repo: source.repo} : {}),
				time: Number(atSeconds) * 1000,
				author: author ?? 'unknown',
				authorEmail: authorEmail ?? '',
				subject: subjectParts.join(GIT_LOG_FIELD_SEP),
				linesChanged: insertions + deletions,
				insertions,
				deletions,
			};
		})
		.filter((commit): commit is CommitEntry => commit !== null)
		.filter(commit => inCommitWindow(commit.time, window.start, window.end));

	if (cacheable) {
		fullTimelineCache.set(cacheKey, {fetchedAt: Date.now(), result: commits});
	}

	return succeeded('Computed commit timeline', commits);
};

/**
 * Each source's commits, in its own `git log` order. Only the board's own repo
 * failing fails the answer: a broken clone is its fetch's to report, and the
 * other sources stay readable.
 */
const readSourceLogs = async (
	repoRoot: string | undefined,
	window: Window,
): Promise<Result<CommitEntry[][]>> => {
	const sourcesResult = await listCommitSources(repoRoot);
	if (isFail(sourcesResult)) return failed(sourcesResult.message);

	const sources = sourcesResult.value;
	const logs = await Promise.all(
		sources.map(source => readSourceLog(source, window)),
	);

	const lists: CommitEntry[][] = [];
	for (const [index, log] of logs.entries()) {
		if (isFail(log)) {
			if (!sources[index]!.repo) return failed(log.message);
			logger.info(`[repos] could not read a clone: ${log.message}`);
			continue;
		}

		lists.push(log.value);
	}

	return succeeded('Read every source', lists);
};

/**
 * Newest first across sources, without reordering any one of them: each list
 * keeps git's own order, which is what "the commit before this one" is read
 * from. A single source comes back exactly as git gave it.
 */
const mergeNewestFirst = <T extends CommitEntry>(lists: T[][]): T[] => {
	const nonEmpty = lists.filter(list => list.length > 0);
	if (nonEmpty.length <= 1) return nonEmpty[0] ?? [];

	const heads = nonEmpty.map(() => 0);
	const merged: T[] = [];

	while (true) {
		let pick = -1;
		let best: T | undefined;

		for (const [index, list] of nonEmpty.entries()) {
			const candidate = list[heads[index]!];
			if (candidate && (!best || candidate.time > best.time)) {
				pick = index;
				best = candidate;
			}
		}

		if (!best) return merged;

		merged.push(best);
		heads[pick]!++;
	}
};

// Pure read of the *code* history, safe mid-scrub: the board's own repo and
// every registered repo's clone, through the same reader.
export const getCommitTimeline = async (
	input: RepoInput & Window = {},
): Promise<Result<CommitEntry[]>> => {
	const listsResult = await readSourceLogs(input.repoRoot, {
		start: input.start,
		end: input.end,
	});
	if (isFail(listsResult)) return failed(listsResult.message);

	return succeeded(
		'Computed commit timeline',
		mergeNewestFirst(listsResult.value),
	);
};

// Matches the convention documented in the epiq skill: a commit's subject is
// prefixed with the issue's ref, e.g. "5S52AC8 message". Reuses the same
// full-history read getCommitTimeline caches rather than a second git
// invocation.
// A matched commit whose immediate predecessor in the *unfiltered* history
// (git log's very next entry, not just the next match) is also a matched
// commit — i.e. no other ticket's commit sits between them.
export type RefCommitEntry = CommitEntry & {precedingSha: string | null};

export const getCommitsForRef = async (
	input: RepoInput & {ref: string},
): Promise<Result<RefCommitEntry[]>> => {
	const ref = input.ref.trim();
	if (!ref) return failed('ref must not be empty');

	// Matching below is a strict `<REF> ` prefix, so a ref of the wrong length
	// can only ever return nothing — which reads identically to "this ticket
	// has no commits". A ref is NODE_REF_LENGTH characters by construction, so
	// any other length is a mistake worth naming rather than answering.
	if (ref.length !== NODE_REF_LENGTH) {
		return failed(
			`"${ref}" is ${ref.length} characters; a ref is ${NODE_REF_LENGTH}. ` +
				`Read it off the issue rather than slicing the id by hand.`,
		);
	}

	const listsResult = await readSourceLogs(input.repoRoot, {});
	if (isFail(listsResult)) return failed(listsResult.message);

	// Case-insensitive, matching nodeRefMatches' convention (source/lib/utils/node-ref.ts)
	// rather than a strict-case prefix: a hand-typed or manually-copied ref
	// should still match, not just one pasted verbatim from the MCP response.
	const prefix = `${ref.toUpperCase()} `;
	const matches = (commit: CommitEntry) =>
		commit.subject.toUpperCase().startsWith(prefix);

	// Per source, in git log's order — so all[i + 1] is exactly the commit
	// immediately before all[i] in that repo's real history, matched or not.
	const perSource = listsResult.value.map(all => {
		const matched: RefCommitEntry[] = [];

		for (const [index, commit] of all.entries()) {
			if (!matches(commit)) continue;

			const precedingCommit = all[index + 1];

			matched.push({
				...commit,
				precedingSha:
					precedingCommit && matches(precedingCommit)
						? precedingCommit.sha
						: null,
			});
		}

		return matched;
	});

	return succeeded('Matched commits by ref', mergeNewestFirst(perSource));
};
