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
	/** The registered repo this commit came from; absent for the board's own repo. */
	repo?: string;
	time: number;
	author: string;
	/** The author's git address, used for matching; the name is display only. */
	authorEmail: string;
	/** The author's contributor on this board, filled in by `withCommitAuthors`. */
	authorIdentity?: CommitAuthor;
	subject: string;
	/**
	 * Refs from `Epiq-Ref:` body lines. They keep refs out of subjects and
	 * survive a squash merge.
	 */
	refs?: string[];
	linesChanged: number;
	insertions: number;
	deletions: number;
};

// Non-printable, so a commit subject can never contain them.
const GIT_LOG_FIELD_SEP = '\x1f';
const GIT_LOG_RECORD_SEP = '\x1e';

// The unwindowed scan, shared by the scrubber and getCommitsForRef moments
// apart.
export const FULL_TIMELINE_CACHE_TTL_MS = 5_000;

const CLONE_LOG_TIMEOUT_MS = 120_000;

/** One clone's log size cap; past it the clone is left out and logged. */
const CLONE_LOG_MAX_CHARS = 32 * 1024 * 1024;

// Per source and walk; a clone's entry, failures included, holds until its
// `version` changes.
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

// A per-read separator, so a subject can't forge records or fields.
const separatorsFor = () => {
	const nonce = randomBytes(8).toString('hex');

	return {
		field: `${GIT_LOG_FIELD_SEP}${nonce}`,
		record: `${GIT_LOG_RECORD_SEP}${nonce}`,
		// The body spans lines, so it is fenced off from the header before it
		// and the --shortstat lines git prints after it.
		body: `${GIT_LOG_FIELD_SEP}B${nonce}`,
		end: `${GIT_LOG_FIELD_SEP}E${nonce}`,
	};
};

// Any line of the body, not just git's trailer block, so squash bodies work.
// One line may list several refs.
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

// Test-only: resets the module-level cache.
export const resetCommitTimelineCacheForTests = (): void => {
	fullTimelineCache.clear();
};

/** After a fetch: a clone's history has moved, so its cached read is stale. */
export const invalidateCommitTimelineCache = (): void => {
	fullTimelineCache.clear();
};

// Commits are plotted at author date but `--since` matches committer date, so
// filter again; the start is compared at whole seconds.
export const inCommitWindow = (
	time: number,
	start: number | undefined,
	end: number | undefined,
): boolean =>
	(start === undefined || time >= Math.floor(start / 1000) * 1000) &&
	(end === undefined || time <= end);

type Window = {start?: number; end?: number};

/** Strips C0/C1 controls and bidi overrides from author-chosen text. */
const cleanText = (value: string | undefined): string =>
	sanitizeInlineText(value).replace(
		/[\u0080-\u009f\u202a-\u202e\u2066-\u2069]/g,
		'',
	);

const readSourceLog = async (
	source: CommitSource,
	window: Window,
): Promise<Result<CommitEntry[]>> => {
	// Only the unwindowed scan is cached: it is costly and repeated, while scoped
	// scrubs are cheap and vary.
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

	const separators = separatorsFor();

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
 * Each source's commits in its own `git log` order. Only the board's own repo
 * failing fails the answer.
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
 * A commit shared by sources, listed once from the first that has it (own repo
 * first). Applied after anything that reads a list's own order.
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
 * Newest first across sources, by date; a single source keeps git's order.
 * Read anything from one repo's order before this.
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

// Commits whose subject starts with the issue's ref, e.g. "5S52AC8 message".
// Contiguous: git log's very next entry is also a match.
export type RefCommitEntry = CommitEntry & {precedingSha: string | null};

/** A commit of several tickets', with the refs of those it carries. */
export type RefsCommitEntry = RefCommitEntry & {tickets: string[]};

// `end` cuts the history at a moment, for a board being replayed there: a
// ticket's commits are those made by then.
type RefInput = RepoInput & {ref: string; end?: number};
type RefsInput = RepoInput & {refs: string[]; end?: number};

/**
 * Several tickets' commits per source in one pass, each in its own repo's
 * order; shared commits are deduplicated afterwards.
 */
const refsMatchesBySource = async (
	input: RefsInput,
): Promise<Result<RefsCommitEntry[][]>> => {
	// A ref of the wrong length could only match nothing, so it's an error.
	const wrong = input.refs.find(ref => ref.length !== NODE_REF_LENGTH);
	if (wrong !== undefined) {
		return failed(
			`"${wrong}" is ${wrong.length} characters; a ref is ${NODE_REF_LENGTH}. ` +
				`Read it off the issue rather than slicing the id by hand.`,
		);
	}

	const listsResult = await readSourceLogs(input.repoRoot, {});
	if (isFail(listsResult)) return failed(listsResult.message);

	// Case-insensitive, like nodeRefMatches, so a hand-typed ref matches.
	const wanted = new Set(input.refs.map(ref => ref.toUpperCase()));
	const ticketsOf = (commit: CommitEntry): string[] => {
		const lead = commit.subject.slice(0, NODE_REF_LENGTH).toUpperCase();
		const named =
			commit.subject[NODE_REF_LENGTH] === ' ' && wanted.has(lead) ? [lead] : [];
		const inBody = (commit.refs ?? []).filter(ref => wanted.has(ref));
		return inBody.length > 0
			? [...new Set([...named, ...inBody])].sort()
			: named;
	};

	// Per source, in git log's order — so all[i + 1] is exactly the commit
	// immediately before all[i] in that repo's real history, matched or not.
	return succeeded(
		'Matched commits by ref',
		listsResult.value.map(all => {
			const matched: RefsCommitEntry[] = [];

			for (const [index, commit] of all.entries()) {
				const tickets = ticketsOf(commit);
				if (tickets.length === 0) continue;
				if (!inCommitWindow(commit.time, undefined, input.end)) continue;

				const precedingCommit = all[index + 1];

				matched.push({
					...commit,
					tickets,
					precedingSha:
						precedingCommit &&
						ticketsOf(precedingCommit).some(ref => tickets.includes(ref))
							? precedingCommit.sha
							: null,
				});
			}

			return matched;
		}),
	);
};

/** One ticket's commits per source; see refsMatchesBySource. */
export const getRefMatchesBySource = async (
	input: RefInput,
): Promise<Result<RefCommitEntry[][]>> => {
	const ref = input.ref.trim();
	if (!ref) return failed('ref must not be empty');

	const bySource = await refsMatchesBySource({...input, refs: [ref]});
	if (isFail(bySource)) return failed(bySource.message);

	return succeeded(
		bySource.message,
		bySource.value.map(list => list.map(({tickets: _, ...commit}) => commit)),
	);
};

export const getCommitsForRef = async (
	input: RefInput,
): Promise<Result<RefCommitEntry[]>> => {
	const bySource = await getRefMatchesBySource(input);
	if (isFail(bySource)) return failed(bySource.message);

	return succeeded(
		'Matched commits by ref',
		mergeNewestFirst(withoutShared(bySource.value)),
	);
};

/**
 * Every commit of several tickets once, newest first, in one order whatever
 * order the refs come in: whole seconds tie often.
 */
export const getCommitsForRefs = async (
	input: RefsInput,
): Promise<Result<RefsCommitEntry[]>> => {
	const bySource = await refsMatchesBySource(input);
	if (isFail(bySource)) return failed(bySource.message);

	return succeeded(
		'Matched commits by refs',
		withoutShared(bySource.value)
			.flat()
			.sort(
				(a, b) =>
					b.time - a.time ||
					(a.repo ?? '').localeCompare(b.repo ?? '') ||
					a.sha.localeCompare(b.sha),
			),
	);
};
