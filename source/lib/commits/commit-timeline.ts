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

// Each candidate's next sha in the whole walk, matched or not: all that is
// kept of a history that can be far longer than the ticket's share of it.
type RefRead = {
	candidates: CommitEntry[];
	precedingOf: Map<string, string | undefined>;
};

// A clone's reads for some refs, held until its `version` changes, as its
// full scan is. The board's own repo is read afresh: it is cheap there.
const cloneRefCache = new Map<
	string,
	{version: number | null; result: Result<RefRead>}
>();
// Enough for every ticket a session opens; the oldest go first.
const CLONE_REF_CACHE_LIMIT = 500;

// Each source's commits that name a ticket, held as its full scan is.
const refCommitsCache = new Map<
	string,
	{fetchedAt: number; version: number | null; result: Result<CommitEntry[]>}
>();

// Test-only: resets the module-level cache.
export const resetCommitTimelineCacheForTests = (): void => {
	fullTimelineCache.clear();
	cloneRefCache.clear();
	refCommitsCache.clear();
};

/** After a fetch: a clone's history has moved, so its cached read is stale. */
export const invalidateCommitTimelineCache = (): void => {
	fullTimelineCache.clear();
	cloneRefCache.clear();
	refCommitsCache.clear();
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

type Separators = ReturnType<typeof separatorsFor>;

/** The log's own options for a source: what it walks and how each commit reads. */
const logArgs = (
	source: CommitSource,
	separators: Separators,
	extra: string[],
	{stats = true}: {stats?: boolean} = {},
): string[] => [
	'log',
	...source.revisions,
	...extra,
	...(stats ? ['--shortstat'] : []),
	// The commit date only where a window is cut by it: the board's own
	// log reads as it always has.
	`--format=${separators.record}%H${separators.field}%at${
		source.notBefore ? `${separators.field}%ct` : ''
	}${separators.field}%an${separators.field}%ae${separators.field}%s${
		separators.body
	}%b${separators.end}`,
];

// Another repo's history can be far longer than the board's own.
const cloneLimits = (source: CommitSource) =>
	source.repo
		? {timeoutMs: CLONE_LOG_TIMEOUT_MS, maxOutput: CLONE_LOG_MAX_CHARS}
		: {};

/** Whether a commit is one the source lists at all. */
const listed = (
	source: CommitSource,
	sha: string | undefined,
	ctSeconds: string | undefined,
): boolean =>
	!!sha &&
	(!source.repo || SHA.test(sha)) &&
	!source.exclude.has(sha) &&
	// By commit date, as the clone's own window is cut: a rebased commit
	// keeps an old author date.
	!(source.notBefore && Number(ctSeconds) * 1000 < source.notBefore);

const parseLog = (
	stdout: string,
	source: CommitSource,
	separators: Separators,
): CommitEntry[] =>
	stdout
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
			const ctSeconds = source.notBefore ? fields[2] : undefined;
			const [author, authorEmail, ...subjectParts] = fields.slice(
				source.notBefore ? 3 : 2,
			);
			if (!atSeconds || !listed(source, sha, ctSeconds)) return null;

			const statText = statLines.join(' ');
			const insertions = Number(/(\d+) insertion/.exec(statText)?.[1] ?? 0);
			const deletions = Number(/(\d+) deletion/.exec(statText)?.[1] ?? 0);

			return {
				sha: sha!,
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
		.filter((commit): commit is CommitEntry => commit !== null);

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
		...cloneLimits(source),
		args: logArgs(source, separators, [
			...(window.start !== undefined
				? [`--since=@${Math.floor(window.start / 1000)}`]
				: []),
			...(window.end !== undefined
				? [`--until=@${Math.floor(window.end / 1000)}`]
				: []),
		]),
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

	const commits = parseLog(logResult.value.stdout, source, separators).filter(
		commit => inCommitWindow(commit.time, window.start, window.end),
	);

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
 * The commits whose message names any of the refs, in log order: git filters,
 * so only those are diffed for their stats. A superset, narrowed by the caller.
 */
const readRefCandidates = async (
	source: CommitSource,
	refs: string[],
): Promise<Result<CommitEntry[]>> => {
	const separators = separatorsFor();
	const logResult = await execGit({
		cwd: source.cwd,
		...cloneLimits(source),
		args: logArgs(source, separators, [
			'--regexp-ignore-case',
			'--fixed-strings',
			...refs.map(ref => `--grep=${ref}`),
		]),
	});
	if (isFail(logResult)) return failed(logResult.message);

	return succeeded(
		'Read commits naming the refs',
		parseLog(logResult.value.stdout, source, separators),
	);
};

/** Every listed commit's sha in log order, without stats: cheap at any length. */
const readSourceOrder = async (
	source: CommitSource,
): Promise<Result<string[]>> => {
	const field = GIT_LOG_FIELD_SEP;
	const logResult = await execGit({
		cwd: source.cwd,
		...cloneLimits(source),
		args: [
			'log',
			...source.revisions,
			`--format=%H${source.notBefore ? `${field}%ct` : ''}`,
		],
	});
	if (isFail(logResult)) return failed(logResult.message);

	return succeeded(
		'Read the commit order',
		logResult.value.stdout
			.split('\n')
			.map(line => line.split(field))
			.filter(([sha, ct]) => listed(source, sha, ct))
			.map(([sha]) => sha!),
	);
};

// Up to this many refs, git's own search beats the full scan; past it (a big
// goal) the scan, cached and shared with the timeline, is cheaper.
const SEARCH_REF_LIMIT = 16;

/** Every commit as a candidate, from the cached full scan. */
const refReadFromScan = async (
	source: CommitSource,
): Promise<Result<RefRead>> => {
	const all = await readSourceLog(source, {});
	if (isFail(all)) return failed(all.message);

	const precedingOf = new Map<string, string | undefined>();
	all.value.forEach((commit, index) =>
		precedingOf.set(commit.sha, all.value[index + 1]?.sha),
	);

	return succeeded('Read every commit', {candidates: all.value, precedingOf});
};

// A fresh string: V8 keeps a slice's whole parent alive.
const detached = (text: string): string => Buffer.from(text).toString();

/** A source's commits naming the refs, each with the commit before it. */
const readRefSource = async (
	source: CommitSource,
	refs: string[],
): Promise<Result<RefRead>> => {
	// A goal's many refs: the cached full scan answers them all at once, where a
	// search per ref set is read afresh each time.
	if (refs.length > SEARCH_REF_LIMIT) return refReadFromScan(source);

	const key = source.repo
		? [
				source.cwd,
				source.revisions.join(' '),
				source.notBefore ?? '',
				source.exclude.size,
				[...refs].sort().join(','),
		  ].join('\0')
		: null;
	const version = source.repo ? cloneVersion(source.cwd) : null;
	const cached = key ? cloneRefCache.get(key) : undefined;
	if (cached && cached.version === version) return cached.result;

	const read = async (): Promise<Result<RefRead>> => {
		const candidates = await readRefCandidates(source, refs);
		if (isFail(candidates)) return failed(candidates.message);
		const order = await readSourceOrder(source);
		if (isFail(order)) return failed(order.message);

		const indexOf = new Map(order.value.map((sha, index) => [sha, index]));
		// Keyed by the candidate's own sha and holding a copy of the next: a
		// slice of the walk's output would keep all of it alive in the cache.
		const precedingOf = new Map<string, string | undefined>();
		for (const commit of candidates.value) {
			const at = indexOf.get(commit.sha);
			const next = at === undefined ? undefined : order.value[at + 1];
			precedingOf.set(commit.sha, next && detached(next));
		}

		return succeeded('Read commits naming the refs', {
			candidates: candidates.value,
			precedingOf,
		});
	};
	const result = await read();

	// A read that ran out of time under load is tried again on the next.
	if (key && !(isFail(result) && isGitTimeout(result.message))) {
		cloneRefCache.delete(key);
		cloneRefCache.set(key, {version, result});
		if (cloneRefCache.size > CLONE_REF_CACHE_LIMIT) {
			cloneRefCache.delete(cloneRefCache.keys().next().value!);
		}
	}

	return result;
};

/**
 * One read per source, in turn. Only the board's own repo failing fails the
 * answer; a clone that can't be read is left out and noted.
 */
const readEverySource = async <T>(
	repoRoot: string | undefined,
	read: (source: CommitSource) => Promise<Result<T>>,
): Promise<Result<T[]>> => {
	const sourcesResult = await listCommitSources(repoRoot);
	if (isFail(sourcesResult)) return failed(sourcesResult.message);

	// One at a time: a read is held whole in memory before it is parsed, and
	// the clones are somebody else's size.
	const values: T[] = [];
	for (const source of sourcesResult.value) {
		const result = await read(source);
		const {repo} = source;

		if (isFail(result)) {
			if (!repo) return failed(result.message);
			logger.info(`[repos] could not read a clone: ${result.message}`);
			noteCloneRead(
				repo,
				isOutputOverflow(result.message)
					? 'its history is too long to read; narrow its window'
					: 'its history could not be read',
			);
			continue;
		}

		if (repo) noteCloneRead(repo, null);
		values.push(result.value);
	}

	return succeeded('Read every source', values);
};

/** Each source's commits in its own `git log` order. */
const readSourceLogs = (
	repoRoot: string | undefined,
	window: Window,
): Promise<Result<CommitEntry[][]>> =>
	readEverySource(repoRoot, source => readSourceLog(source, window));

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

const detachedCommit = (commit: CommitEntry): CommitEntry => ({
	...commit,
	sha: detached(commit.sha),
	author: detached(commit.author),
	authorEmail: detached(commit.authorEmail),
	subject: detached(commit.subject),
	...(commit.refs ? {refs: commit.refs.map(detached)} : {}),
});

/**
 * A source's commits that `names` holds to name a ticket, with their stats. A
 * walk without diffs finds them; only they are diffed, so history from before
 * any ticket costs a read, not a diff.
 */
const readRefCommits = async (
	source: CommitSource,
	names: (commit: CommitEntry) => boolean,
): Promise<Result<CommitEntry[]>> => {
	const cacheKey = [
		source.cwd,
		source.revisions.join(' '),
		source.notBefore ?? '',
		source.exclude.size,
	].join('\0');
	const cached = refCommitsCache.get(cacheKey);
	const version = source.repo ? cloneVersion(source.cwd) : null;
	if (
		cached &&
		(source.repo
			? cached.version === version
			: Date.now() - cached.fetchedAt < scanCacheMs(FULL_TIMELINE_CACHE_TTL_MS))
	) {
		return cached.result;
	}

	const read = async (): Promise<Result<CommitEntry[]>> => {
		const separators = separatorsFor();
		const walk = await execGit({
			cwd: source.cwd,
			...cloneLimits(source),
			args: logArgs(source, separators, [], {stats: false}),
		});
		if (isFail(walk)) return failed(walk.message);

		// Copies: a slice of the walk's output would keep all of it alive.
		const named = parseLog(walk.value.stdout, source, separators)
			.filter(names)
			.map(detachedCommit);
		if (named.length === 0) return succeeded('No commit names a ticket', []);

		const record = separators.record;
		const stats = await execGit({
			cwd: source.cwd,
			...cloneLimits(source),
			args: [
				'log',
				'--no-walk=unsorted',
				'--stdin',
				'--shortstat',
				`--format=${record}%H`,
			],
			input: `${named.map(commit => commit.sha).join('\n')}\n`,
		});
		if (isFail(stats)) return failed(stats.message);

		const bySha = new Map<string, {insertions: number; deletions: number}>();
		for (const entry of stats.value.stdout.split(record)) {
			const [sha = '', ...rest] = entry.split('\n');
			const text = rest.join(' ');
			bySha.set(sha.trim(), {
				insertions: Number(/(\d+) insertion/.exec(text)?.[1] ?? 0),
				deletions: Number(/(\d+) deletion/.exec(text)?.[1] ?? 0),
			});
		}

		return succeeded(
			'Read the commits that name a ticket',
			named.map(commit => {
				const {insertions = 0, deletions = 0} = bySha.get(commit.sha) ?? {};
				return {
					...commit,
					insertions,
					deletions,
					linesChanged: insertions + deletions,
				};
			}),
		);
	};
	const result = await read();

	// A read that ran out of time under load is tried again on the next.
	if (!(isFail(result) && isGitTimeout(result.message))) {
		refCommitsCache.set(cacheKey, {fetchedAt: Date.now(), version, result});
	}

	return result;
};

/**
 * Every commit that names a ticket, newest first across sources, each once:
 * the ticket totals' read, which needs no other commit's diff.
 */
export const getRefCommitTimeline = async (
	repoRoot: string | undefined,
	names: (commit: CommitEntry) => boolean,
): Promise<Result<CommitEntry[]>> => {
	const lists = await readEverySource(repoRoot, source =>
		readRefCommits(source, names),
	);
	if (isFail(lists)) return failed(lists.message);

	return succeeded(
		'Computed the commits that name a ticket',
		mergeNewestFirst(withoutShared(lists.value)),
	);
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

// A commit carrying the ref in its subject or an Epiq-Ref line. `precedingSha`:
// the next log entry, when it shares a ticket.
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

	const readsResult = await readEverySource(input.repoRoot, source =>
		readRefSource(source, input.refs),
	);
	if (isFail(readsResult)) return failed(readsResult.message);

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

	// Per source, in git log's order. A commit's predecessor is the next sha in
	// the whole walk, matched or not; only a candidate can share a ticket.
	return succeeded(
		'Matched commits by ref',
		readsResult.value.map(({candidates, precedingOf}) => {
			const ticketsBySha = new Map<string, string[]>();
			for (const commit of candidates) {
				const tickets = ticketsOf(commit);
				if (tickets.length > 0) ticketsBySha.set(commit.sha, tickets);
			}

			const matched: RefsCommitEntry[] = [];
			for (const commit of candidates) {
				const tickets = ticketsBySha.get(commit.sha);
				if (!tickets) continue;
				if (!inCommitWindow(commit.time, undefined, input.end)) continue;

				const preceding = precedingOf.get(commit.sha);
				const shared = preceding ? ticketsBySha.get(preceding) ?? [] : [];

				matched.push({
					...commit,
					tickets,
					precedingSha: shared.some(ref => tickets.includes(ref))
						? preceding!
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
