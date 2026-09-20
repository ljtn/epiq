import {execGit, readGitBlobsBatch} from '../../git/git-utils.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {isPlausibleSha, RepoInput, resolveRepoRoot} from './commit-repo.js';
import {getCommitsForRef} from './commit-timeline.js';

export type CommitDiffFile = {
	path: string;
	before: string;
	after: string;
	insertions: number;
	deletions: number;
	// Git's own answer, not a guess from the bytes: a file it will not diff,
	// because it holds a NUL early on or `.gitattributes` says `-diff`. Both
	// sides are empty for one of these — the content is never read, since the
	// only thing anything could do with it is decline to draw it.
	isBinary: boolean;
};

export type CommitDiff = {
	sha: string;
	files: CommitDiffFile[];
};

/**
 * One commit as git's own unified patch.
 *
 * `getCommitDiff` above hands back each file's two whole revisions, which is
 * what a renderer that computes its own hunks wants. A terminal draws the
 * patch as git wrote it, so it asks for that instead rather than re-deriving
 * hunks that would disagree with git about renames, binary files and the
 * missing trailing newline.
 *
 * `--no-ext-diff` because a configured external diff driver would hand back
 * something that is not a patch at all, and `--format=` leaves the commit
 * header off — the list the reader came from already showed it.
 */
export const getCommitPatch = async (
	input: RepoInput & {sha: string},
): Promise<Result<string>> => {
	if (!isPlausibleSha(input.sha)) return failed('Invalid commit sha');

	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const showResult = await execGit({
		cwd: repoRootResult.value,
		args: [
			'show',
			'--no-ext-diff',
			'--no-color',
			'--patch',
			'--find-renames',
			'--format=',
			input.sha,
		],
	});
	if (isFail(showResult)) return failed(showResult.message);

	return succeeded('Read commit patch', showResult.value.stdout);
};

// Bounds payload size for a pathological commit (a vendored dep, a lockfile
// rewrite) rather than the editor-tab-count concern MAX_DIFF_FILES_FOR_SIDE_BY_SIDE
// exists for — a rendered accordion tolerates far more files than open windows do.
const MAX_DIFF_FILES_FOR_DATA = 200;

// All zeros (--abbrev=40 gives 40 hex chars) is git's own way of writing "no
// blob on this side" in --raw output — the file was added or deleted here.
const isZeroBlob = (hash: string): boolean => /^0+$/.test(hash);

// `:<oldmode> <newmode> <oldblob> <newblob> <status>[score]\t<path>` — with
// --no-renames every line is a plain add/modify/delete of one path, never a
// two-path rename/copy line, so a single trailing field is always correct.
const RAW_DIFF_LINE =
	/^:\d{6} \d{6} ([0-9a-f]{40}) ([0-9a-f]{40}) [A-Z]\d*\t(.+)$/;

// `<insertions>\t<deletions>\t<path>`, or `-\t-\t<path>` for a binary file,
// which has no line count to give.
const NUMSTAT_LINE = /^(\d+|-)\t(\d+|-)\t(.+)$/;

type ChangedFileBlobs = {
	path: string;
	// null means "no blob on this side" (the file was added or deleted here),
	// same convention getChangedFilePaths' callers already read a missing
	// blob as — not a git failure.
	beforeBlob: string | null;
	afterBlob: string | null;
	insertions: number;
	deletions: number;
	isBinary: boolean;
};

// Blob hashes straight from git's own diff, rather than getChangedFilePaths'
// name-only listing: this is what lets getCommitDiff below read every
// changed file's content in one `git cat-file --batch` round trip instead of
// two `git show` spawns per file. `--numstat` rides along in the same spawn,
// so each file's line counts come for free: git prints the raw block and the
// numstat block one after the other, and the two line shapes are disjoint.
// `--abbrev=40` forces full hashes — unlike
// `--full-index` (documented for this but, at least as of Apple Git 2.39.5,
// a no-op outside of `-p` patch output), this reliably defeats the
// repo-size-dependent abbreviation `--raw` uses by default.
// Any two revisions, not just a commit and its parent: one commit's diff is
// `<sha>~1 <sha>`, a whole ticket's is its oldest commit's parent against its
// newest. `paths`, when given, narrows the answer to those files — which is
// how the ticket-wide diff keeps another ticket's commits out of it.
const getChangedFileBlobs = async (
	repoRoot: string,
	from: string,
	to: string,
	paths?: string[],
): Promise<Result<ChangedFileBlobs[]>> => {
	const diffResult = await execGit({
		cwd: repoRoot,
		args: [
			'diff',
			'--raw',
			'--numstat',
			'--no-renames',
			'--abbrev=40',
			from,
			to,
			// `--` is what stops a path that looks like a revision being read as
			// one; without it a file called `main` would silently change the diff.
			...(paths && paths.length > 0 ? ['--', ...paths] : []),
		],
	});
	if (isFail(diffResult)) return failed(diffResult.message);

	const lines = diffResult.value.stdout.split('\n').filter(line => line !== '');

	// A line neither format matches is a sign the assumed format itself is
	// wrong for this git version/commit shape (already bit once this session:
	// --full-index turned out to be a no-op) — surfacing it as a failure beats
	// silently under-reporting a commit's real files.
	const unparseable = lines.filter(
		line => !RAW_DIFF_LINE.test(line) && !NUMSTAT_LINE.test(line),
	);
	if (unparseable.length > 0) {
		return failed(
			`Could not parse ${unparseable.length} line(s) of "git diff --raw --numstat" output, e.g. "${unparseable[0]}"`,
		);
	}

	// A binary file's `-` counts as nothing changed line-wise, which is true —
	// and the dash itself is the answer to a second question, which is whether
	// git will diff this file at all. Both dashes together is how it says no,
	// so that is read here rather than flattened to a pair of zeroes and lost.
	//
	// Only where the line was there to say it: a path with no numstat line at
	// all falls through to the defaults below, and "git said nothing" is not
	// "git said binary".
	const countsByPath = new Map<
		string,
		{insertions: number; deletions: number; isBinary: boolean}
	>();
	for (const line of lines) {
		const match = NUMSTAT_LINE.exec(line);
		if (!match) continue;

		countsByPath.set(match[3] ?? '', {
			insertions: match[1] === '-' ? 0 : Number(match[1]),
			deletions: match[2] === '-' ? 0 : Number(match[2]),
			isBinary: match[1] === '-' && match[2] === '-',
		});
	}

	const entries = lines
		.filter(line => RAW_DIFF_LINE.test(line))
		.map((line): ChangedFileBlobs => {
			const match = RAW_DIFF_LINE.exec(line);
			const beforeBlob = match?.[1] ?? '';
			const afterBlob = match?.[2] ?? '';
			const path = match?.[3] ?? '';

			return {
				path,
				beforeBlob: isZeroBlob(beforeBlob) ? null : beforeBlob,
				afterBlob: isZeroBlob(afterBlob) ? null : afterBlob,
				...(countsByPath.get(path) ?? {
					insertions: 0,
					deletions: 0,
					isBinary: false,
				}),
			};
		});

	return succeeded('Listed changed files with blob hashes', entries);
};

// Reads `entries` into the CommitDiffFile shape the GUI draws, pulling every
// before/after blob in one `git cat-file --batch`. Shared by the one-commit
// diff and the ticket-wide one, which differ only in the revisions they asked
// git to compare.
const readDiffFiles = async (
	repoRoot: string,
	entries: ChangedFileBlobs[],
): Promise<Result<CommitDiffFile[]>> => {
	if (entries.length > MAX_DIFF_FILES_FOR_DATA) {
		return failed(
			`${entries.length} files changed — too many to show as a diff`,
		);
	}

	// A binary file's blobs are not read at all. Nothing downstream can do
	// anything with the bytes but decline to draw them, and reading them means
	// an image or a video crossing the websocket in full, per file, per commit,
	// to be decoded as UTF-8 at the other end.
	const blobHashes = entries.flatMap(entry =>
		entry.isBinary
			? []
			: [entry.beforeBlob, entry.afterBlob].filter(
					(hash): hash is string => hash !== null,
			  ),
	);

	const blobsResult = await readGitBlobsBatch(blobHashes, repoRoot);
	if (isFail(blobsResult)) return failed(blobsResult.message);

	const blobs = blobsResult.value;

	return succeeded(
		'Read changed file contents',
		entries.map(entry => ({
			path: entry.path,
			before:
				entry.isBinary || !entry.beforeBlob
					? ''
					: blobs.get(entry.beforeBlob) ?? '',
			after:
				entry.isBinary || !entry.afterBlob
					? ''
					: blobs.get(entry.afterBlob) ?? '',
			insertions: entry.insertions,
			deletions: entry.deletions,
			isBinary: entry.isBinary,
		})),
	);
};

// The GUI diff panel's data source: reads every changed file's before/after
// content in one `git diff --raw` (blob hashes) plus one `git cat-file
// --batch` (content for all of them), rather than the O(files) `git show`
// spawns the editor path above uses — each spawn pays real process-start
// overhead regardless of how little it reads, which dominated wall time on
// any commit touching more than a couple of files. Never touches the
// materialized state singleton, so it is independent of any time-travel
// checkout.
export const getCommitDiff = async (
	input: RepoInput & {sha: string},
): Promise<Result<CommitDiff>> => {
	if (!isPlausibleSha(input.sha)) return failed('Invalid commit sha');

	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);
	const repoRoot = repoRootResult.value;

	const entriesResult = await getChangedFileBlobs(
		repoRoot,
		`${input.sha}~1`,
		input.sha,
	);
	if (isFail(entriesResult)) return failed(entriesResult.message);

	// A commit that changed nothing is a commit the reader was pointed at in
	// error, so it is said rather than drawn as an empty list. A ticket whose
	// commits cancel out is a different matter — see getSquashedDiffForRef.
	if (entriesResult.value.length === 0) {
		return failed('No changed files found for this commit');
	}

	const filesResult = await readDiffFiles(repoRoot, entriesResult.value);
	if (isFail(filesResult)) return failed(filesResult.message);

	const files = filesResult.value;

	return succeeded('Loaded commit diff', {sha: input.sha, files});
};

/**
 * A file in the compacted diff, and the commit a comment on it anchors to.
 *
 * The last of the ticket's commits to touch this file — the same pairing
 * `FilePointer` uses to link the Stats tab into a diff. Not the ticket's
 * newest commit, which usually touched only a fraction of its files: anchoring
 * there would name a commit whose diff has no such file, and the permalink
 * would open it and find nothing.
 *
 * Per file it is exact where it has to be. A selection's line numbers are real
 * line numbers within the side they belong to, and `additions` is the newer
 * file — and this file's content at the last commit to touch it is its content
 * at the ticket's newest commit, since nothing after that touched it. So an
 * additions-side line transfers with no arithmetic at all.
 */
export type SquashedDiffFile = CommitDiffFile & {sha: string};

export type SquashedDiff = {
	ref: string;
	// The revisions compared: the oldest commit's parent, and the newest
	// commit. Carried so a reader can reproduce the diff by hand.
	from: string;
	to: string;
	commits: number;
	files: SquashedDiffFile[];
	// Whether the ticket's commits are a contiguous run of real history. When
	// they are, this diff is exactly what the ticket did and nothing else.
	contiguous: boolean;
	// Only when they are not: files this ticket touched that a commit from
	// outside it also touched somewhere in the range. Those files' diffs carry
	// the other change too, and there is no way to take it back out without
	// replaying the ticket's commits onto a tree of their own. Empty means the
	// interleaving happened to miss every file this ticket cares about, and
	// the diff is exact after all.
	overlappingPaths: string[];
};

// `<sha>` on a line of its own, then that commit's `--raw` lines. `-z` is not
// used: a path containing a newline would already have broken RAW_DIFF_LINE
// everywhere else here, and git quotes such a path rather than emitting it raw.
const LOG_COMMIT_LINE = /^[0-9a-f]{40}$/;

/**
 * Every commit in `from..to` with the paths it touched.
 *
 * One spawn for the whole range, rather than one `git diff` per commit: the
 * range is a ticket's worth of history, and process start dominates.
 */
const changedPathsByCommit = async (
	repoRoot: string,
	from: string,
	to: string,
): Promise<Result<Map<string, Set<string>>>> => {
	const logResult = await execGit({
		cwd: repoRoot,
		args: [
			'log',
			'--raw',
			'--no-renames',
			'--abbrev=40',
			// Merges stay silent here, deliberately. `--diff-merges=first-parent`
			// would give them raw lines and so an anchor for the files they bring
			// in — but this walk also builds the pathspec the non-contiguous diff
			// is narrowed to, and a merge's first-parent diff is everything the
			// other branch carried. A ticket whose ref reached a merge commit
			// would then render that whole branch as its own change, or exceed
			// the file cap and render nothing. A merge introduces no work of this
			// ticket's, so it contributes no paths.
			'--format=%H',
			`${from}..${to}`,
		],
	});
	if (isFail(logResult)) return failed(logResult.message);

	const byCommit = new Map<string, Set<string>>();
	let current: Set<string> | null = null;

	for (const line of logResult.value.stdout.split('\n')) {
		if (LOG_COMMIT_LINE.test(line)) {
			current = new Set<string>();
			byCommit.set(line, current);
			continue;
		}

		const match = RAW_DIFF_LINE.exec(line);
		if (match && current) current.add(match[3] ?? '');
	}

	return succeeded('Listed changed paths per commit', byCommit);
};

const union = (sets: Iterable<Set<string>>): Set<string> => {
	const all = new Set<string>();
	for (const set of sets) for (const value of set) all.add(value);

	return all;
};

/** Whether `candidate` is on the line of history leading to `head`. */
const isAncestor = async (
	repoRoot: string,
	candidate: string,
	head: string,
): Promise<boolean> => {
	if (candidate === head) return true;

	const result = await execGit({
		cwd: repoRoot,
		args: ['merge-base', '--is-ancestor', candidate, head],
	});

	// A non-zero exit is the answer "no", not a failure to answer.
	return !isFail(result);
};

// git's own hash for the empty tree: what a root commit's diff is against.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** `<sha>~1`, or the empty tree when `sha` is a root commit and has no parent. */
const parentOf = async (repoRoot: string, sha: string): Promise<string> => {
	const result = await execGit({
		cwd: repoRoot,
		args: ['rev-parse', '--verify', '--quiet', `${sha}^1`],
	});

	return isFail(result) ? EMPTY_TREE : `${sha}~1`;
};

/**
 * A ticket's commits as one diff — what the Diff tab's compacted view draws.
 *
 * Two things make this more than `git diff <oldest>~1 <newest>`.
 *
 * The first is that a ref matches commits across *every branch*
 * (getCommitTimeline walks `--branches`), and this repository keeps a worktree
 * per ticket. A rebase leaves the pre-rebase copy of a commit reachable from
 * the stale branch, so a ticket routinely matches two or three copies of the
 * same work on diverged lines of history. Diffing between two of them compares
 * across the divergence and hands back everything that ever differed between
 * those branches — measured at 51 files and +2048 lines for a ticket that
 * touched a handful. So the endpoints are pinned to one line: the newest
 * match, and the oldest match that is an ancestor of it.
 *
 * The second is that even on one line the commits need not be adjacent —
 * another ticket's commit can sit between two of this one's. A plain range
 * diff would then quietly hand back both tickets' work as this ticket's, so
 * the range is narrowed to the paths this ticket's own commits touched, and
 * any of those paths a foreign commit also touched is named in
 * `overlappingPaths` rather than passed off as clean. Taking the foreign
 * change back out would mean replaying this ticket's commits onto a tree of
 * their own, which can conflict and is a great deal of machinery for a case
 * the workflow already makes rare.
 *
 * Adjacency is read off the range walk rather than off `precedingSha`, which
 * is adjacency in that same cross-branch listing and so says "contiguous" for
 * two copies of one commit that merely sort next to each other.
 */
export const getSquashedDiffForRef = async (
	input: RepoInput & {ref: string},
): Promise<Result<SquashedDiff>> => {
	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);
	const repoRoot = repoRootResult.value;

	const commitsResult = await getCommitsForRef({repoRoot, ref: input.ref});
	if (isFail(commitsResult)) return failed(commitsResult.message);

	// Newest first, as getCommitsForRef returns them.
	const matched = commitsResult.value;
	if (matched.length === 0) return failed('No commits reference this ticket');

	const newest = matched[0]!.sha;

	// From the oldest end: the first match that is on the newest's line of
	// history is where this ticket's work begins on that line. A healthy
	// ticket answers on the first ask; a ticket with rebase copies pays one
	// cheap `merge-base` per copy it has to pass over.
	let oldest = newest;
	for (let index = matched.length - 1; index > 0; index--) {
		const candidate = matched[index]!.sha;
		if (await isAncestor(repoRoot, candidate, newest)) {
			oldest = candidate;
			break;
		}
	}

	const from = await parentOf(repoRoot, oldest);

	// Every commit in the range, ours and anybody else's, with the paths it
	// touched. One spawn, and it answers all three questions left: which of
	// the matches are really on this line, whether anything else is, and what
	// to narrow to if so.
	const walkResult = await changedPathsByCommit(repoRoot, from, newest);
	if (isFail(walkResult)) return failed(walkResult.message);

	const walk = walkResult.value;
	const matchedShas = new Set(matched.map(commit => commit.sha));
	const mine = [...walk.keys()].filter(sha => matchedShas.has(sha));

	const contiguous = mine.length === walk.size;

	// `mine` is newest first, so the first commit found touching a path is the
	// last one to have touched it.
	const anchorByPath = new Map<string, string>();
	for (const sha of mine) {
		for (const path of walk.get(sha) ?? []) {
			if (!anchorByPath.has(path)) anchorByPath.set(path, sha);
		}
	}

	const answer = (
		files: CommitDiffFile[],
		overlappingPaths: string[],
	): Result<SquashedDiff> =>
		succeeded('Loaded squashed diff', {
			ref: input.ref.trim().toUpperCase(),
			from,
			to: newest,
			// The commits this diff actually covers, which is not every commit
			// carrying the ref: a copy left behind by a rebase is not a second
			// commit's worth of work.
			commits: mine.length,
			// The range diff's paths are a subset of the paths its commits
			// touched, so every file has an anchor; `newest` is a floor rather
			// than a case, for a shape of history that would surprise us.
			files: files.map(file => ({
				...file,
				sha: anchorByPath.get(file.path) ?? newest,
			})),
			contiguous,
			overlappingPaths,
		});

	let paths: string[] | undefined;
	let overlappingPaths: string[] = [];

	if (!contiguous) {
		const ours = union(mine.map(sha => walk.get(sha) ?? new Set<string>()));
		const theirs = union(
			[...walk.entries()]
				.filter(([sha]) => !matchedShas.has(sha))
				.map(([, touched]) => touched),
		);

		// `git diff A B --` with no pathspec is a full diff, not an empty one, so
		// a ticket whose commits touched nothing git reports (an empty commit, a
		// merge) has to be answered here rather than by narrowing to nothing.
		if (ours.size === 0) return answer([], []);

		paths = [...ours];
		overlappingPaths = [...ours].filter(path => theirs.has(path)).sort();
	}

	const entriesResult = await getChangedFileBlobs(
		repoRoot,
		from,
		newest,
		paths,
	);
	if (isFail(entriesResult)) return failed(entriesResult.message);

	const filesResult = await readDiffFiles(repoRoot, entriesResult.value);
	if (isFail(filesResult)) return failed(filesResult.message);

	return answer(filesResult.value, overlappingPaths);
};
