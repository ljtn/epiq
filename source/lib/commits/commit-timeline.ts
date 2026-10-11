import {execGit} from '../../git/git-utils.js';
import {CommitAuthor} from '../repository/contributor-directory.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {scanCacheMs} from '../utils/cache-ttl.js';
import {NODE_REF_LENGTH} from '../utils/node-ref.js';
import {resolveSourceRef, SourceInput} from './commit-repo.js';

export type CommitEntry = {
	sha: string;
	// Which source's history this commit was read from: `"self"` for the
	// board's own repository, a registered source id otherwise. Filled by
	// every read here; optional only so a hand-built entry keeps compiling.
	sourceId?: string;
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

let fullTimelineCache: {
	sourceId: string;
	gitPath: string;
	stateBranch: string | undefined;
	fetchedAt: number;
	result: CommitEntry[];
} | null = null;

// Test-only: the cache is module-level state, so it would otherwise leak
// between `it()` blocks in the same file (unlike vi.clearAllMocks(), which
// only resets mock call state, not arbitrary module variables).
export const resetCommitTimelineCacheForTests = (): void => {
	fullTimelineCache = null;
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

// Pure read of a source's history, safe mid-scrub. For the board's own
// repository, `--not <stateBranch>` is required: worktrees share one ref
// namespace, so epiq's own state commits would otherwise appear mixed into
// real development history. A registered source is read from a bare clone
// that holds nothing else, so there is no branch to exclude there.
export const getCommitTimeline = async (
	input: SourceInput & {start?: number; end?: number} = {},
): Promise<Result<CommitEntry[]>> => {
	const sourceResult = resolveSourceRef(input);
	if (isFail(sourceResult)) return failed(sourceResult.message);

	const source = sourceResult.value;

	// Only the unwindowed call is cached — it is the expensive, frequently-
	// repeated one (a full `--shortstat` scan of the whole history); a
	// start/end-scoped scrub is comparatively cheap and varies request to
	// request, so caching it would mostly just grow a cache no one re-hits.
	const cacheable = input.start === undefined && input.end === undefined;

	if (
		cacheable &&
		fullTimelineCache &&
		fullTimelineCache.sourceId === source.id &&
		fullTimelineCache.gitPath === source.gitPath &&
		fullTimelineCache.stateBranch === source.stateBranch &&
		Date.now() - fullTimelineCache.fetchedAt <
			scanCacheMs(FULL_TIMELINE_CACHE_TTL_MS)
	) {
		return succeeded('Computed commit timeline', fullTimelineCache.result);
	}

	const logResult = await execGit({
		cwd: source.gitPath,
		args: [
			'log',
			'--branches',
			...(source.stateBranch !== undefined
				? ['--not', source.stateBranch]
				: []),
			...(input.start !== undefined
				? [`--since=@${Math.floor(input.start / 1000)}`]
				: []),
			...(input.end !== undefined
				? [`--until=@${Math.floor(input.end / 1000)}`]
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

			const statText = statLines.join(' ');
			const insertions = Number(/(\d+) insertion/.exec(statText)?.[1] ?? 0);
			const deletions = Number(/(\d+) deletion/.exec(statText)?.[1] ?? 0);

			return {
				sha,
				sourceId: source.id,
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
		.filter(commit => inCommitWindow(commit.time, input.start, input.end));

	if (cacheable) {
		fullTimelineCache = {
			sourceId: source.id,
			gitPath: source.gitPath,
			stateBranch: source.stateBranch,
			fetchedAt: Date.now(),
			result: commits,
		};
	}

	return succeeded('Computed commit timeline', commits);
};

// Matches the convention documented in the epiq skill: a commit's subject is
// prefixed with the issue's ref, e.g. "5S52AC8 message". Reuses
// getCommitTimeline's full-history read rather than a second git invocation —
// same repo, same state-branch exclusion, and this repo's whole history is a
// few thousand commits at most.
// A matched commit whose immediate predecessor in the *unfiltered* history
// (git log's very next entry, not just the next match) is also a matched
// commit — i.e. no other ticket's commit sits between them.
export type RefCommitEntry = CommitEntry & {precedingSha: string | null};

export const getCommitsForRef = async (
	input: SourceInput & {ref: string},
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

	const timelineResult = await getCommitTimeline({
		repoRoot: input.repoRoot,
		sourceId: input.sourceId,
	});
	if (isFail(timelineResult)) return failed(timelineResult.message);

	// Case-insensitive, matching nodeRefMatches' convention (source/lib/utils/node-ref.ts)
	// rather than a strict-case prefix: a hand-typed or manually-copied ref
	// should still match, not just one pasted verbatim from the MCP response.
	const prefix = `${ref.toUpperCase()} `;
	const matches = (commit: CommitEntry) =>
		commit.subject.toUpperCase().startsWith(prefix);

	// Newest-first, same order git log itself returns — so all[i + 1] is
	// exactly the commit immediately before all[i] in real history, matched
	// or not.
	const all = timelineResult.value;

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

	return succeeded('Matched commits by ref', matched);
};
