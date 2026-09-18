import {execGit} from '../../git/git-utils.js';
import {CommitAuthor} from '../repository/contributor-directory.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {readProjectFile} from '../project-setup/project-setup.js';
import {NODE_REF_LENGTH} from '../utils/node-ref.js';
import {RepoInput, resolveRepoRoot} from './commit-repo.js';

export type CommitEntry = {
	sha: string;
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
	repoRoot: string;
	stateBranch: string;
	fetchedAt: number;
	result: CommitEntry[];
} | null = null;

// Test-only: the cache is module-level state, so it would otherwise leak
// between `it()` blocks in the same file (unlike vi.clearAllMocks(), which
// only resets mock call state, not arbitrary module variables).
export const resetCommitTimelineCacheForTests = (): void => {
	fullTimelineCache = null;
};

// Pure read of the *code* repo's history, safe mid-scrub. `--not <stateBranch>`
// is required: worktrees share one ref namespace, so epiq's own state commits
// would otherwise appear mixed into real development history.
export const getCommitTimeline = async (
	input: RepoInput & {start?: number; end?: number} = {},
): Promise<Result<CommitEntry[]>> => {
	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const projectResult = readProjectFile(repoRootResult.value);
	if (isFail(projectResult)) return failed(projectResult.message);

	// Only the unwindowed call is cached — it is the expensive, frequently-
	// repeated one (a full `--shortstat` scan of the whole history); a
	// start/end-scoped scrub is comparatively cheap and varies request to
	// request, so caching it would mostly just grow a cache no one re-hits.
	const cacheable = input.start === undefined && input.end === undefined;

	if (
		cacheable &&
		fullTimelineCache &&
		fullTimelineCache.repoRoot === repoRootResult.value &&
		fullTimelineCache.stateBranch === projectResult.value.stateBranch &&
		Date.now() - fullTimelineCache.fetchedAt < FULL_TIMELINE_CACHE_TTL_MS
	) {
		return succeeded('Computed commit timeline', fullTimelineCache.result);
	}

	const logResult = await execGit({
		cwd: repoRootResult.value,
		args: [
			'log',
			'--branches',
			'--not',
			projectResult.value.stateBranch,
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
		// `--since`/`--until` match on the committer date, but a commit is plotted
		// at its author date, and a rebase moves the two days apart. Left in, such
		// a commit sits outside the window it was fetched for and stretches the
		// axis to reach it.
		.filter(
			commit =>
				(input.start === undefined || commit.time >= input.start) &&
				(input.end === undefined || commit.time <= input.end),
		);

	if (cacheable) {
		fullTimelineCache = {
			repoRoot: repoRootResult.value,
			stateBranch: projectResult.value.stateBranch,
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

	const timelineResult = await getCommitTimeline({repoRoot: input.repoRoot});
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
