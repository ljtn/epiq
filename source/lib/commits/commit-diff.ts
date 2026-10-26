import {randomBytes} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
	execGit,
	isOutputOverflow,
	readGitBlobsBatch,
} from '../../git/git-utils.js';
import {logger} from '../../logger.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {
	CommitInput,
	isPlausibleSha,
	RepoInput,
	resolveRepoRoot,
} from './commit-repo.js';
import {
	listCommitSources,
	resolveCommitCwd,
	sourceCwdOf,
} from './commit-sources.js';
import {
	CommitEntry,
	getRefMatchesBySource,
	RefCommitEntry,
	withoutShared,
} from './commit-timeline.js';

export type CommitDiffFile = {
	path: string;
	before: string;
	after: string;
	insertions: number;
	deletions: number;
	// Git won't diff this file (an early NUL, or `-diff`); both sides are empty
	// and the content is never read.
	isBinary: boolean;
};

export type CommitDiff = {
	sha: string;
	repo?: string;
	files: CommitDiffFile[];
	/** The message below the subject, where there is one. */
	body?: string;
};

// Strips controls and bidi overrides from an author-chosen body, keeping
// newlines and tabs.
const cleanBody = (body: string): string =>
	body
		.replace(/\r\n?/g, '\n')
		.replace(
			/[\x00-\x08\x0B-\x1F\x7F\u0080-\u009f\u202a-\u202e\u2066-\u2069]/g,
			'',
		)
		.trim();

const commitBody = async (repoRoot: string, sha: string): Promise<string> => {
	const result = await execGit({
		cwd: repoRoot,
		args: ['log', '-1', '--no-show-signature', '--format=%b', sha, '--'],
	});

	return isFail(result) ? '' : cleanBody(result.value.stdout);
};

/**
 * Commits with their bodies: one `git log` per repo, shas on stdin. Separators
 * carry a nonce so a hostile body can't forge another commit.
 */
export const withCommitBodies = async <T extends CommitEntry>(
	repoRoot: string,
	commits: Result<T[]>,
): Promise<Result<Array<T & {body?: string}>>> => {
	if (isFail(commits) || commits.value.length === 0) return commits;

	const sources = await listCommitSources(repoRoot);
	if (isFail(sources)) return commits;

	const nonce = randomBytes(8).toString('hex');
	const record = `\x1e${nonce}`;
	const field = `\x1f${nonce}`;
	const bodies = new Map<string, string>();

	// git refuses the whole list over one sha that is not a commit there, as a
	// rebased-away one is not: those are asked about first and left out.
	const commitsAmong = async (cwd: string, shas: string[]) => {
		const checked = await execGit({
			cwd,
			args: ['cat-file', '--batch-check=%(objectname) %(objecttype)'],
			input: `${shas.join('\n')}\n`,
		});
		if (isFail(checked)) return [];

		return checked.value.stdout
			.split('\n')
			.filter(line => line.endsWith(' commit'))
			.map(line => line.slice(0, line.indexOf(' ')));
	};

	const readBodies = async (cwd: string, shas: string[]) => {
		const log = await execGit({
			cwd,
			args: [
				'log',
				'--no-walk=unsorted',
				'--no-show-signature',
				'--stdin',
				`--format=${record}%H${field}%b`,
				'--',
			],
			input: `${shas.join('\n')}\n`,
		});
		if (isFail(log)) return;

		for (const entry of log.value.stdout.split(record)) {
			const at = entry.indexOf(field);
			if (at === -1) continue;

			const body = cleanBody(entry.slice(at + field.length));
			if (body) bodies.set(entry.slice(0, at).trim(), body);
		}
	};

	for (const source of sources.value) {
		const shas = commits.value
			.filter(commit => commit.repo === source.repo)
			.map(commit => commit.sha)
			.filter(isPlausibleSha);
		if (shas.length === 0) continue;

		const found = await commitsAmong(source.cwd, shas);
		if (found.length > 0) await readBodies(source.cwd, found);
	}

	return succeeded(
		commits.message,
		commits.value.map(commit => {
			const body = bodies.get(commit.sha);
			return body ? {...commit, body} : commit;
		}),
	);
};

const MAX_PATCH_CHARS = 8 * 1024 * 1024;

/**
 * One commit as git's own unified patch, for the terminal. `--no-ext-diff`
 * keeps external drivers out; `--format=` drops the header.
 */
export const getCommitPatch = async (
	input: CommitInput,
): Promise<Result<string>> => {
	if (!isPlausibleSha(input.sha)) return failed('Invalid commit sha');

	const repoRootResult = await resolveCommitCwd(input);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const showResult = await execGit({
		cwd: repoRootResult.value,
		// What a terminal can page through: past this a patch is a vendored
		// tree or a generated file, and drawing it would hold every row of it.
		maxOutput: MAX_PATCH_CHARS,
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
	if (isFail(showResult)) {
		return failed(
			isOutputOverflow(showResult.message)
				? 'This commit is too large to show here; open it in your editor'
				: showResult.message,
		);
	}

	return succeeded('Read commit patch', showResult.value.stdout);
};

// Caps payload size for a pathological commit (vendored dep, lockfile rewrite).
const MAX_DIFF_FILES_FOR_DATA = 200;

// All zeros (--abbrev=40 gives 40 hex chars) is git's own way of writing "no
// blob on this side" in --raw output — the file was added or deleted here.
const isZeroBlob = (hash: string): boolean => /^0+$/.test(hash);

// `:<oldmode> <newmode> <oldblob> <newblob> <status>[score]\t<path>`; with
// --no-renames there is always one path.
const RAW_DIFF_LINE =
	/^:\d{6} \d{6} ([0-9a-f]{40}) ([0-9a-f]{40}) [A-Z]\d*\t(.+)$/;

// `<insertions>\t<deletions>\t<path>`, or `-\t-\t<path>` for a binary file,
// which has no line count to give.
const NUMSTAT_LINE = /^(\d+|-)\t(\d+|-)\t(.+)$/;

type ChangedFileBlobs = {
	path: string;
	// null: no blob on this side (added or deleted), not a git failure.
	beforeBlob: string | null;
	afterBlob: string | null;
	insertions: number;
	deletions: number;
	isBinary: boolean;
};

// Blob hashes and numstat for two revisions in one spawn, so content can be
// read in one `cat-file --batch`. `--abbrev=40`, since `--full-index` is a
// no-op without `-p`. `paths` narrows the answer.
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
	// git's own words, with every option epiq runs it under, are for the log;
	// the reader gets the outcome.
	if (isFail(diffResult)) {
		logger.info(`[commits] diff ${from} ${to}: ${diffResult.message}`);
		return failed(DIFF_UNREADABLE);
	}

	const lines = diffResult.value.stdout.split('\n').filter(line => line !== '');

	// An unmatched line means the assumed format is wrong; fail rather than
	// under-report files.
	const unparseable = lines.filter(
		line => !RAW_DIFF_LINE.test(line) && !NUMSTAT_LINE.test(line),
	);
	if (unparseable.length > 0) {
		return failed(
			`Could not parse ${unparseable.length} line(s) of "git diff --raw --numstat" output, e.g. "${unparseable[0]}"`,
		);
	}

	// Both counts `-` means git won't diff the file. A path with no numstat line
	// at all is not binary.
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

// Reads `entries` into CommitDiffFiles, every blob in one `git cat-file --batch`.
const readDiffFiles = async (
	repoRoot: string,
	entries: ChangedFileBlobs[],
): Promise<Result<CommitDiffFile[]>> => {
	if (entries.length > MAX_DIFF_FILES_FOR_DATA) {
		return failed(
			`${entries.length} files changed — too many to show as a diff`,
		);
	}

	// A binary file's blobs are never read: nothing downstream draws them.
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

	// A side the read left out was past MAX_BLOB_BYTES: declined like a binary
	// file, rather than drawn as an empty one.
	const unread = (blob: string | null) => blob !== null && !blobs.has(blob);

	return succeeded(
		'Read changed file contents',
		entries.map(entry => {
			const isBinary =
				entry.isBinary || unread(entry.beforeBlob) || unread(entry.afterBlob);

			return {
				path: entry.path,
				before:
					isBinary || !entry.beforeBlob
						? ''
						: blobs.get(entry.beforeBlob) ?? '',
				after:
					isBinary || !entry.afterBlob ? '' : blobs.get(entry.afterBlob) ?? '',
				insertions: entry.insertions,
				deletions: entry.deletions,
				isBinary,
			};
		}),
	);
};

// The GUI diff panel's data: one `git diff --raw` plus one `cat-file --batch`.
// Independent of the materialized state, so time travel doesn't affect it.
export const getCommitDiff = async (
	input: CommitInput,
): Promise<Result<CommitDiff>> => {
	if (!isPlausibleSha(input.sha)) return failed('Invalid commit sha');

	const repoRootResult = await resolveCommitCwd(input);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);
	const repoRoot = repoRootResult.value;

	// Beside the diff rather than after it, since it costs a spawn of its own.
	const bodyRead = commitBody(repoRoot, input.sha);

	let entriesResult = await getChangedFileBlobs(
		repoRoot,
		`${input.sha}~1`,
		input.sha,
	);

	// Asked only on a failure, so a commit with a parent costs one spawn: one
	// without is a root, diffed against nothing, or a shallow clone's edge.
	if (isFail(entriesResult) && entriesResult.message === DIFF_UNREADABLE) {
		const parent = await parentOf(repoRoot, input.sha);
		if (isFail(parent)) return failed(parent.message);
		if (parent.value === EMPTY_TREE) {
			entriesResult = await getChangedFileBlobs(
				repoRoot,
				EMPTY_TREE,
				input.sha,
			);
		}
	}
	if (isFail(entriesResult)) return failed(entriesResult.message);

	// An empty commit is reported, not drawn as an empty list.
	if (entriesResult.value.length === 0) {
		return failed('No changed files found for this commit');
	}

	const filesResult = await readDiffFiles(repoRoot, entriesResult.value);
	if (isFail(filesResult)) return failed(filesResult.message);

	const files = filesResult.value;
	const body = await bodyRead;

	return succeeded('Loaded commit diff', {
		sha: input.sha,
		...(input.repo ? {repo: input.repo} : {}),
		files,
		...(body ? {body} : {}),
	});
};

/**
 * A file in the compacted diff, anchored to the last ticket commit that
 * touched it, so additions-side line numbers carry over unchanged.
 */
export type SquashedDiffFile = CommitDiffFile & {
	sha: string;
	/** The registered repo the file is in; absent for the board's own. */
	repo?: string;
};

export type SquashedDiff = {
	ref: string;
	// The compared revisions (oldest's parent, newest); the first repo's when the
	// ticket spans repos, `parts` has each.
	from: string;
	to: string;
	/** One per repo the ticket's commits are in, only when there is more than one. */
	parts?: Array<{
		repo?: string;
		from: string;
		to: string;
		commits: number;
		contiguous: boolean;
	}>;
	commits: number;
	files: SquashedDiffFile[];
	// Whether the ticket's commits are a contiguous run of real history. When
	// they are, this diff is exactly what the ticket did and nothing else.
	contiguous: boolean;
	// Files this ticket touched that a foreign commit in the range also touched;
	// their diffs include the foreign change.
	overlappingPaths: string[];
};

// `<sha>` on its own line, then its `--raw` lines.
const LOG_COMMIT_LINE = /^[0-9a-f]{40}$/;

/** Every commit in `from..to` with the paths it touched, in one spawn. */
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
			// Merges contribute no paths: their first-parent diff would pull a whole
			// branch into the ticket's pathspec.
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

const DIFF_UNREADABLE = "Could not read this commit's diff";

/** Said where a commit's parent lies before the window its clone was cut at. */
export const PARENT_OUTSIDE_HISTORY =
	'Its parent is outside the fetched history. Widen since to see this diff.';

// Whether `sha` is where a clone cut at a date ends: git keeps those in the
// repository's `shallow` file and shows them with no parents.
const isShallowBoundary = async (
	repoRoot: string,
	sha: string,
): Promise<boolean> => {
	const shallow = await execGit({
		cwd: repoRoot,
		args: ['rev-parse', '--git-path', 'shallow'],
	});
	if (isFail(shallow)) return false;

	try {
		return fs
			.readFileSync(path.resolve(repoRoot, shallow.value.stdout.trim()), 'utf8')
			.split('\n')
			.some(line => line !== '' && line.startsWith(sha));
	} catch {
		return false;
	}
};

/**
 * `<sha>~1`, or the empty tree for a root commit. A shallow-edge commit is
 * refused rather than drawn as adding everything.
 */
const parentOf = async (
	repoRoot: string,
	sha: string,
): Promise<Result<string>> => {
	const result = await execGit({
		cwd: repoRoot,
		args: ['rev-parse', '--verify', '--quiet', `${sha}^1`],
	});
	if (!isFail(result)) return succeeded('Parent', `${sha}~1`);

	return (await isShallowBoundary(repoRoot, sha))
		? failed(PARENT_OUTSIDE_HISTORY)
		: succeeded('A root commit', EMPTY_TREE);
};

/**
 * A ticket's commits as one diff. Endpoints are pinned to one line of history
 * (rebase copies live on stale branches), and the range is narrowed to the
 * ticket's own paths, with foreign overlaps named in `overlappingPaths`.
 * Adjacency comes from the range walk, never `precedingSha`, which pairs rebase copies.
 */
export const getSquashedDiffForRef = async (
	input: RepoInput & {ref: string; end?: number},
): Promise<Result<SquashedDiff>> => {
	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);
	const repoRoot = repoRootResult.value;

	// Per repo, each commit once; shared matches still count when judging a range.
	const bySourceResult = await getRefMatchesBySource({
		repoRoot,
		ref: input.ref,
		end: input.end,
	});
	if (isFail(bySourceResult)) return failed(bySourceResult.message);

	const ticketShas = new Set(
		bySourceResult.value.flat().map(commit => commit.sha),
	);

	const sourcesResult = await listCommitSources(repoRoot);
	if (isFail(sourcesResult)) return failed(sourcesResult.message);
	const cwdOfRepo = sourceCwdOf(sourcesResult.value);

	// Each repo's history is its own: a range can only be drawn inside one.
	// In each repo's own order, which is what the range is read off.
	const byRepo = new Map<string, RefCommitEntry[]>();
	for (const own of withoutShared(bySourceResult.value)) {
		if (own.length > 0) byRepo.set(own[0]!.repo ?? '', own);
	}

	const parts: Array<{repo?: string; diff: SquashedDiff}> = [];
	// Repos whose share could not be read (clone gone or broken).
	let unread = 0;
	for (const [key, matched] of byRepo) {
		const cwd = cwdOfRepo(key);
		if (!cwd) {
			unread += 1;
			continue;
		}

		const diffResult = await squashInRepo(cwd, input.ref, matched, ticketShas);
		// Another repo's clone failing costs its own files, never the board's:
		// the timeline reads around a broken clone the same way.
		if (isFail(diffResult)) {
			if (!key) return failed(diffResult.message);
			logger.info(`[repos] could not squash ${key}: ${diffResult.message}`);
			unread += 1;
			continue;
		}

		const repo = key || undefined;
		parts.push({
			repo,
			diff: {
				...diffResult.value,
				files: diffResult.value.files.map(file =>
					repo ? {...file, repo} : file,
				),
				// Qualified as `<repo>:<path>` for another repo's file, the key the
				// GUI tells files apart by: two repos can each have a README.
				overlappingPaths: diffResult.value.overlappingPaths.map(path =>
					repo ? `${repo}:${path}` : path,
				),
			},
		});
	}

	const [first, ...rest] = parts;
	if (!first) {
		return failed(
			unread > 0
				? 'The clone holding this ticket’s commits could not be read'
				: 'No commits reference this ticket',
		);
	}
	if (rest.length === 0) return succeeded('Loaded squashed diff', first.diff);

	return succeeded('Loaded squashed diff', {
		...first.diff,
		commits: parts.reduce((sum, part) => sum + part.diff.commits, 0),
		files: parts.flatMap(part => part.diff.files),
		contiguous: parts.every(part => part.diff.contiguous),
		overlappingPaths: parts.flatMap(part => part.diff.overlappingPaths),
		parts: parts.map(({repo, diff}) => ({
			...(repo ? {repo} : {}),
			from: diff.from,
			to: diff.to,
			commits: diff.commits,
			contiguous: diff.contiguous,
		})),
	});
};

/** One repo's share of a ticket, `matched` newest first. */
const squashInRepo = async (
	repoRoot: string,
	ref: string,
	matched: RefCommitEntry[],
	// The ticket's commits in every repo: one this repo shares with another
	// is the ticket's work in a range here too, not another ticket's.
	ticketShas: ReadonlySet<string> = new Set(),
): Promise<Result<SquashedDiff>> => {
	const newest = matched[0]!.sha;

	// The oldest match on the newest's line of history starts the range.
	let oldest = newest;
	for (let index = matched.length - 1; index > 0; index--) {
		const candidate = matched[index]!.sha;
		if (await isAncestor(repoRoot, candidate, newest)) {
			oldest = candidate;
			break;
		}
	}

	const parent = await parentOf(repoRoot, oldest);
	if (isFail(parent)) return failed(parent.message);
	const from = parent.value;

	// Every commit in the range with its paths, in one spawn.
	const walkResult = await changedPathsByCommit(repoRoot, from, newest);
	if (isFail(walkResult)) return failed(walkResult.message);

	const walk = walkResult.value;
	const ownShas = new Set(matched.map(commit => commit.sha));
	const matchedShas = new Set([...ownShas, ...ticketShas]);
	// This repo's share: what it counts, anchors to and shows. A commit it
	// shares with another repo is shown there.
	const mine = [...walk.keys()].filter(sha => ownShas.has(sha));
	const ticketWork = [...walk.keys()].filter(sha => matchedShas.has(sha));

	const contiguous = ticketWork.length === walk.size;
	const sharesWork = ticketWork.length > mine.length;

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
			ref: ref.trim().toUpperCase(),
			from,
			to: newest,
			// The commits this diff covers; a rebase copy is not one.
			commits: mine.length,
			// Every file has an anchor; `newest` is only a fallback.
			files: files.map(file => ({
				...file,
				sha: anchorByPath.get(file.path) ?? newest,
			})),
			contiguous,
			overlappingPaths,
		});

	let paths: string[] | undefined;
	let overlappingPaths: string[] = [];

	if (!contiguous || sharesWork) {
		const ours = union(mine.map(sha => walk.get(sha) ?? new Set<string>()));
		const theirs = union(
			[...walk.entries()]
				.filter(([sha]) => !matchedShas.has(sha))
				.map(([, touched]) => touched),
		);

		// An empty pathspec means a full diff, so no paths is answered here.
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
