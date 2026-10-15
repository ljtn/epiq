import {randomBytes} from 'node:crypto';
import fs from 'node:fs';
import {execGit, isGitTimeout, isOutputOverflow} from '../../git/git-utils.js';
import {logger} from '../../logger.js';
import {CommitAuthor} from '../repository/contributor-directory.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {scanCacheMs} from '../utils/cache-ttl.js';
import {NODE_REF_LENGTH} from '../utils/node-ref.js';
import {sanitizeInlineText} from '../utils/string.utils.js';
import {RepoInput} from './commit-repo.js';
import {
	CommitSource,
	listCommitSources,
	noteCloneRead,
} from './commit-sources.js';

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
	/**
	 * Refs named by `Epiq-Ref:` lines in the body. They link a commit to its
	 * tickets without a ref in the subject, which would otherwise end up in
	 * the history of repos the board's tickets are not public to; and they
	 * survive a squash merge, whose body carries the squashed messages.
	 */
	refs?: string[];
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

const CLONE_LOG_TIMEOUT_MS = 120_000;

/**
 * One clone's log, at most. Another repo's history is its owner's to make as
 * long as they like, and twenty of them held at once would be more memory
 * than a server has; past this a clone is left out and the reason logged.
 */
const CLONE_LOG_MAX_CHARS = 32 * 1024 * 1024;

// Per source, keyed by where it is read and what is walked. A clone's entry
// is good for as long as the clone is unchanged — `version` — failures
// included: only a fetch changes a clone, and a read past the cap would fail
// again on every call.
const fullTimelineCache = new Map<
	string,
	{fetchedAt: number; version: number | null; result: Result<CommitEntry[]>}
>();

/** When a clone's fetch status was last written, by any process. */
const cloneVersion = (clonePath: string): number | null => {
	try {
		return fs.statSync(`${clonePath}.json`).mtimeMs;
	} catch {
		return null;
	}
};

// A clone's history is somebody else's, and a subject can hold the record
// and field separators: a separator only this read knows cannot be forged.
const separatorsFor = (source: CommitSource) => {
	const nonce = source.repo ? randomBytes(8).toString('hex') : '';

	return {
		field: `${GIT_LOG_FIELD_SEP}${nonce}`,
		record: `${GIT_LOG_RECORD_SEP}${nonce}`,
		// The body spans lines, so it is fenced off from the header before it
		// and the --shortstat lines git prints after it.
		body: `${GIT_LOG_FIELD_SEP}B${nonce}`,
		end: `${GIT_LOG_FIELD_SEP}E${nonce}`,
	};
};

// A line of its own, anywhere in the body: a squash commit carries each
// squashed message's lines mid-body, where git's own trailer parsing (last
// paragraph only) would not find them. One line may list several refs.
const REF_TRAILER = /^[ \t]*Epiq-Ref:[ \t]*(.*)$/gim;
// A ref is the tail of a ULID: Crockford base32, which has no I, L, O or U.
const REF_TOKEN = new RegExp(`^[0-9A-HJKMNP-TV-Z]{${NODE_REF_LENGTH}}$`, 'i');

export const bodyRefs = (body: string): string[] => [
	...new Set(
		[...body.matchAll(REF_TRAILER)]
			.flatMap(m => m[1]!.split(/[\s,]+/))
			.filter(token => REF_TOKEN.test(token))
			.map(token => token.toUpperCase()),
	),
];

const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

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

/**
 * Text a commit carries, as it may be drawn: whoever wrote the commit chose
 * every byte, and a terminal obeys an escape sequence — C0 and C1 controls
 * alike — while a bidi override makes a subject read as something else.
 */
const cleanText = (value: string | undefined): string =>
	sanitizeInlineText(value).replace(
		/[\u0080-\u009f\u202a-\u202e\u2066-\u2069]/g,
		'',
	);

const readSourceLog = async (
	source: CommitSource,
	window: Window,
): Promise<Result<CommitEntry[]>> => {
	// Only the unwindowed call is cached — it is the expensive, frequently-
	// repeated one (a full `--shortstat` scan of the whole history); a
	// start/end-scoped scrub is comparatively cheap and varies request to
	// request, so caching it would mostly just grow a cache no one re-hits.
	const cacheable = window.start === undefined && window.end === undefined;
	const cacheKey = [
		source.cwd,
		source.revisions.join(' '),
		source.notBefore ?? '',
		source.exclude.size,
	].join('\0');
	const cached = cacheable ? fullTimelineCache.get(cacheKey) : undefined;
	const version = source.repo ? cloneVersion(source.cwd) : null;

	if (
		cached &&
		(source.repo
			? cached.version === version
			: Date.now() - cached.fetchedAt < scanCacheMs(FULL_TIMELINE_CACHE_TTL_MS))
	) {
		return cached.result;
	}

	const separators = separatorsFor(source);

	const logResult = await execGit({
		cwd: source.cwd,
		// Another repo's history can be far longer than the board's own, and it
		// was asked for in full when its window is `all`.
		...(source.repo
			? {timeoutMs: CLONE_LOG_TIMEOUT_MS, maxOutput: CLONE_LOG_MAX_CHARS}
			: {}),
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
			// The commit date only where a window is cut by it: the board's own
			// log reads as it always has.
			`--format=${separators.record}%H${separators.field}%at${
				source.notBefore ? `${separators.field}%ct` : ''
			}${separators.field}%an${separators.field}%ae${separators.field}%s${
				separators.body
			}%b${separators.end}`,
		],
	});

	if (isFail(logResult)) {
		// A read that ran out of time under load is tried again on the next.
		if (source.repo && cacheable && !isGitTimeout(logResult.message)) {
			fullTimelineCache.set(cacheKey, {
				fetchedAt: Date.now(),
				version,
				result: failed(logResult.message),
			});
		}
		return failed(logResult.message);
	}

	const commits = logResult.value.stdout
		.split(separators.record)
		.filter(record => record.trim().length > 0)
		.map((record): CommitEntry | null => {
			// Without the end marker (output in the old one-line form) the header
			// is the first line and the rest is --shortstat, as before bodies.
			const endAt = record.indexOf(separators.end);
			const [firstLine = '', ...restLines] = record.split('\n');
			const head = endAt === -1 ? firstLine : record.slice(0, endAt);
			const statLines =
				endAt === -1
					? restLines
					: record.slice(endAt + separators.end.length).split('\n');
			const bodyAt = head.indexOf(separators.body);
			const headerLine = bodyAt === -1 ? head : head.slice(0, bodyAt);
			const refs =
				bodyAt === -1
					? []
					: bodyRefs(head.slice(bodyAt + separators.body.length));
			const fields = headerLine.split(separators.field);
			const [sha, atSeconds] = fields;
			if (source.repo && !SHA.test(sha ?? '')) return null;
			const ctSeconds = source.notBefore ? fields[2] : undefined;
			const [author, authorEmail, ...subjectParts] = fields.slice(
				source.notBefore ? 3 : 2,
			);
			if (!sha || !atSeconds) return null;
			if (source.exclude.has(sha)) return null;
			// By commit date, as the clone's own window is cut: a rebased commit
			// keeps an old author date.
			if (source.notBefore && Number(ctSeconds) * 1000 < source.notBefore) {
				return null;
			}

			const statText = statLines.join(' ');
			const insertions = Number(/(\d+) insertion/.exec(statText)?.[1] ?? 0);
			const deletions = Number(/(\d+) deletion/.exec(statText)?.[1] ?? 0);

			return {
				sha,
				...(source.repo ? {repo: source.repo} : {}),
				time: Number(atSeconds) * 1000,
				author: cleanText(author) || 'unknown',
				authorEmail: cleanText(authorEmail),
				subject: cleanText(subjectParts.join(separators.field)),
				...(refs.length > 0 ? {refs} : {}),
				linesChanged: insertions + deletions,
				insertions,
				deletions,
			};
		})
		.filter((commit): commit is CommitEntry => commit !== null)
		.filter(commit => inCommitWindow(commit.time, window.start, window.end));

	if (cacheable) {
		fullTimelineCache.set(cacheKey, {
			fetchedAt: Date.now(),
			version,
			result: succeeded('Computed commit timeline', commits),
		});
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
	// One at a time: each log is read whole into memory before it is parsed,
	// and the clones are somebody else's size.
	const logs: Result<CommitEntry[]>[] = [];
	for (const source of sources) logs.push(await readSourceLog(source, window));

	const lists: CommitEntry[][] = [];
	for (const [index, log] of logs.entries()) {
		const repo = sources[index]!.repo;
		if (isFail(log)) {
			if (!repo) return failed(log.message);
			logger.info(`[repos] could not read a clone: ${log.message}`);
			noteCloneRead(
				repo,
				isOutputOverflow(log.message)
					? 'its history is too long to read; narrow its window'
					: 'its history could not be read',
			);
			continue;
		}

		if (repo) noteCloneRead(repo, null);

		lists.push(log.value);
	}

	return succeeded('Read every source', lists);
};

/**
 * A commit two sources share — a fork, or the board's own remote registered by
 * mistake — listed once, from the first source that has it: the board's own
 * repo before any other. Applied after anything read off a list's own order,
 * which still needs the commits it shares.
 */
export const withoutShared = <T extends CommitEntry>(lists: T[][]): T[][] => {
	if (lists.length <= 1) return lists;

	const seen = new Set<string>();

	return lists.map(list => {
		const fresh = list.filter(commit => !seen.has(commit.sha));
		for (const commit of fresh) seen.add(commit.sha);
		return fresh;
	});
};

/**
 * Newest first across sources, by date. A single source comes back exactly as
 * git gave it; across several, git's order is each repo's own and says
 * nothing about another's. Anything read off one repo's order — "the commit
 * before this one" — is read before this.
 */
const mergeNewestFirst = <T extends CommitEntry>(lists: T[][]): T[] => {
	const nonEmpty = lists.filter(list => list.length > 0);
	if (nonEmpty.length <= 1) return nonEmpty[0] ?? [];

	// Stable, so commits of one second keep their repo's order.
	return nonEmpty.flat().sort((a, b) => b.time - a.time);
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
		mergeNewestFirst(withoutShared(listsResult.value)),
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

/**
 * A ticket's commits per source, each in its own repo's order, before a commit
 * two sources share is listed once: a fork's share of a ticket is read off its
 * own history, shared commits included.
 */
export const getRefMatchesBySource = async (
	input: RepoInput & {ref: string},
): Promise<Result<RefCommitEntry[][]>> => {
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
		commit.subject.toUpperCase().startsWith(prefix) ||
		commit.refs?.includes(ref.toUpperCase()) === true;

	// Per source, in git log's order — so all[i + 1] is exactly the commit
	// immediately before all[i] in that repo's real history, matched or not.
	return succeeded(
		'Matched commits by ref',
		listsResult.value.map(all => {
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
		}),
	);
};

export const getCommitsForRef = async (
	input: RepoInput & {ref: string},
): Promise<Result<RefCommitEntry[]>> => {
	const bySource = await getRefMatchesBySource(input);
	if (isFail(bySource)) return failed(bySource.message);

	return succeeded(
		'Matched commits by ref',
		mergeNewestFirst(withoutShared(bySource.value)),
	);
};
