import {existsSync} from 'node:fs';
import {chmod} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getStateBranchRoot} from '../git/git-storage.js';
import {execGit} from '../git/git-utils.js';
import {
	getEditorCandidates,
	isVSCodeEditor,
	openEditorDiffNonBlocking,
	openEditorOnFileNonBlocking,
} from '../lib/editor/editor.js';
import {getEventTime} from '../lib/event/date-utils.js';
import {
	loadMergedEvents,
	loadMergedEventsBefore,
} from '../lib/event/event-load.js';
import {materializeAll} from '../lib/event/event-materialize.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {readProjectFile} from '../lib/project-setup/project-setup.js';
import {fileManager} from '../lib/storage/file-manager.js';
import {resolveClosestEpiqProjectRoot} from '../lib/storage/paths.js';
import {
	getState,
	isStateInitialized,
	patchState,
	resetState,
} from '../lib/state/state.js';
import {ApiTimeTravelStatus} from './api-state.model.js';

type ToolInput = {repoRoot?: string};

// Bucket slot count used to divide whatever window is requested. The loop
// below iterates over events, not over bucket slots, and the returned map
// only ever holds as many entries as there are non-empty buckets (bounded by
// real event count) — so a high slot count costs nothing in time or payload
// size, it just gives finer resolution. This is what makes a narrower scope
// (e.g. "week") noticeably more precise than "all time": the same slot count
// divided over a much shorter window yields much smaller buckets.
const TIMELINE_BUCKET_COUNT = 100_000;

// Tracks how far back the shared singleton is currently checked out. Not part
// of AppState because it's purely a GUI-server bookkeeping concern (the TUI
// tracks its own equivalent locally within `:peek`/`:replay`).
let currentAsOfTime: number | null = null;

// Serializes every operation that reads-then-writes the shared state
// singleton across an `await` (checkout, return-to-live, and — imported into
// api-autosync.ts — the autosync tick's post-sync refresh). Without this, a
// scrub landing during an in-flight `sync()`'s git round-trip gets silently
// overwritten the moment that sync's `boot()` runs, since a "still live?"
// check taken before an `await` can go stale by the time execution resumes.
// Chaining onto the previous promise (ignoring its outcome) queues callers
// strictly in arrival order and guarantees only one runs at a time.
let opQueue: Promise<unknown> = Promise.resolve();

export const runExclusive = <T>(fn: () => Promise<T>): Promise<T> => {
	const result = opQueue.then(fn, fn);
	opQueue = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
};

const resolveRepoRoot = (repoRoot?: string): Result<string> => {
	const result = resolveClosestEpiqProjectRoot(repoRoot ?? process.cwd());
	if (isFail(result)) return failed(result.message);

	return succeeded('Resolved Epiq repo root', result.value);
};

const resolveStateBranchRoot = (repoRoot?: string): Result<string> => {
	const repoRootResult = resolveRepoRoot(repoRoot);
	if (isFail(repoRootResult)) return repoRootResult;

	return getStateBranchRoot({repoRoot: repoRootResult.value});
};

export const getTimeTravelStatus = (): ApiTimeTravelStatus => {
	if (!isStateInitialized()) return {mode: 'live', asOfTime: null};

	const {timeMode} = getState();

	return timeMode === 'live'
		? {mode: 'live', asOfTime: null}
		: {mode: 'scrub', asOfTime: currentAsOfTime};
};

export type EventTimelineBucket = {t: number; count: number};

export type EventTimeline = {
	bucketMs: number;
	buckets: EventTimelineBucket[];
	earliest: number;
	latest: number;
};

// Pure read of persisted event timestamps, bucketed for the scrubber's density
// display. Never touches the materialized state singleton, so it's safe to call
// at any time, including mid-scrub.
//
// `start`/`end` scope the window to bucket over — omit both for the default
// "all time" view ([earliest event, now]). Narrowing the window (e.g. to a
// single week) buckets that same fixed TIMELINE_BUCKET_COUNT across a much
// shorter span, which is what gives a scoped view its extra precision — no
// separate resolution knob needed.
export const getEventTimeline = async (
	input: ToolInput & {start?: number; end?: number} = {},
): Promise<Result<EventTimeline>> => {
	const stateBranchRootResult = resolveStateBranchRoot(input.repoRoot);
	if (isFail(stateBranchRootResult))
		return failed(stateBranchRootResult.message);

	const eventsResult = loadMergedEvents(stateBranchRootResult.value);
	if (isFail(eventsResult)) return failed(eventsResult.message);

	const allTimes = eventsResult.value
		.map(getEventTime)
		.filter((t): t is number => t !== null);

	const now = Date.now();
	const windowEnd = input.end ?? now;
	const windowStart =
		input.start ?? (allTimes.length > 0 ? Math.min(...allTimes) : windowEnd);

	if (windowEnd <= windowStart) {
		return succeeded('Empty time window', {
			bucketMs: 0,
			buckets: [],
			earliest: windowStart,
			latest: windowEnd,
		});
	}

	const times = allTimes
		.filter(t => t >= windowStart && t < windowEnd)
		.sort((a, b) => a - b);

	const bucketMs = Math.max(
		1,
		Math.ceil((windowEnd - windowStart) / TIMELINE_BUCKET_COUNT),
	);

	const countsByBucketStart = new Map<number, number>();

	for (const t of times) {
		const bucketIndex = Math.min(
			TIMELINE_BUCKET_COUNT - 1,
			Math.floor((t - windowStart) / bucketMs),
		);
		const bucketStart = windowStart + bucketIndex * bucketMs;

		countsByBucketStart.set(
			bucketStart,
			(countsByBucketStart.get(bucketStart) ?? 0) + 1,
		);
	}

	const buckets = [...countsByBucketStart.entries()]
		.sort(([a], [b]) => a - b)
		.map(([t, count]) => ({t, count}));

	return succeeded('Computed event timeline', {
		bucketMs,
		buckets,
		earliest: windowStart,
		latest: windowEnd,
	});
};

export type CommitEntry = {
	sha: string;
	time: number;
	author: string;
	subject: string;
};

// Non-printable separator, safe against commit subjects containing "|" etc.
const GIT_LOG_FIELD_SEP = '\x1f';

// Pure read of the *code* repo's commit history — a distinct git root from
// the event log's state-branch worktree (resolveStateBranchRoot above), and
// deliberately excludes the epiq state branch's own commits: worktrees share
// one ref namespace, so without `--not <stateBranch>` they'd show up mixed in
// with real development history.
export const getCommitTimeline = async (
	input: ToolInput & {start?: number; end?: number} = {},
): Promise<Result<CommitEntry[]>> => {
	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const projectResult = readProjectFile(repoRootResult.value);
	if (isFail(projectResult)) return failed(projectResult.message);

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
			`--format=%H${GIT_LOG_FIELD_SEP}%at${GIT_LOG_FIELD_SEP}%an${GIT_LOG_FIELD_SEP}%s`,
		],
	});

	if (isFail(logResult)) return failed(logResult.message);

	const commits = logResult.value.stdout
		.split('\n')
		.filter(line => line.trim().length > 0)
		.map((line): CommitEntry | null => {
			const [sha, atSeconds, author, ...subjectParts] =
				line.split(GIT_LOG_FIELD_SEP);
			if (!sha || !atSeconds) return null;

			return {
				sha,
				time: Number(atSeconds) * 1000,
				author: author ?? 'unknown',
				subject: subjectParts.join(GIT_LOG_FIELD_SEP),
			};
		})
		.filter((commit): commit is CommitEntry => commit !== null);

	return succeeded('Computed commit timeline', commits);
};

// Git object shas are hex — enforced here mainly because `sha` flows straight
// into a `git show <sha>` argv slot. Without this, a string starting with
// `-` would be parsed by git as a flag rather than a revision (argument
// injection, not shell injection, but still worth closing off).
const isPlausibleSha = (sha: string): boolean => /^[0-9a-f]{7,40}$/i.test(sha);

// A plain unified diff (one file, `git show <sha>` verbatim) — VS Code (and
// most editors) apply basic diff syntax highlighting (the +/- lines, file
// headers) to a .diff file, but NOT the underlying language's own grammar to
// the code inside it, so it reads as mostly-monochrome text. Works with any
// editor though, and is the universal fallback below.
const openCommitAsUnifiedDiff = async (
	repoRoot: string,
	sha: string,
): Promise<Result<true>> => {
	const showResult = await execGit({cwd: repoRoot, args: ['show', sha]});
	if (isFail(showResult)) return failed(showResult.message);

	const tmpDir = path.join(os.tmpdir(), 'epiq', 'commit-diffs');
	fileManager.mkDir(tmpDir);

	// Named after the sha, not a random id — the diff for a given commit is
	// deterministic, so re-inspecting the same commit reopens the same file
	// instead of littering the tmp dir with duplicates.
	const tmpPath = path.join(tmpDir, `${sha}.diff`);

	// Only write (and lock down) the file the first time — it's already
	// chmod 0o444 after that, and re-writing would fail with EACCES.
	if (!existsSync(tmpPath)) {
		fileManager.writeToFile(tmpPath, showResult.value.stdout);
		await chmod(tmpPath, 0o444);
	}

	return openEditorOnFileNonBlocking(tmpPath);
};

// Commits touching more files than this fall back to the plain unified diff
// instead — opening dozens of side-by-side tabs at once is more overwhelming
// than helpful, and slower to launch (one `code --diff` spawn per file).
const MAX_DIFF_FILES_FOR_SIDE_BY_SIDE = 12;

// How long to wait, after forcing open a brand new VS Code window for the
// first changed file, before opening the rest with --reuse-window. Purely a
// heuristic — there's no CLI signal for "the new window now exists and is
// focused" — chosen to comfortably exceed how long a new Electron window
// normally takes to come up on typical hardware.
const NEW_WINDOW_SETTLE_MS = 800;

// Reads a file's content as of a given git revision. A missing blob (the
// file was added or deleted at this commit, so it doesn't exist on one side)
// isn't a real failure here — it just means that side of the diff is empty.
const readFileAtRevision = async (
	repoRoot: string,
	revision: string,
	filePath: string,
): Promise<string> => {
	const result = await execGit({
		cwd: repoRoot,
		args: ['show', `${revision}:${filePath}`],
	});

	return isFail(result) ? '' : result.value.stdout;
};

// One VS Code native two-pane diff tab per changed file, each side written
// out under its own real filename so VS Code's language detection sees the
// actual extension (e.g. .tsx) and applies proper syntax highlighting —
// unlike the unified-diff fallback, which VS Code only diff-highlights at
// the line level (+/-), not the code itself.
const openCommitAsSideBySideDiffs = async (
	repoRoot: string,
	sha: string,
	editor: string,
): Promise<Result<true>> => {
	const filesResult = await execGit({
		cwd: repoRoot,
		args: ['diff-tree', '--no-commit-id', '--name-only', '-r', sha],
	});
	if (isFail(filesResult)) return failed(filesResult.message);

	const filePaths = filesResult.value.stdout
		.split('\n')
		.map(line => line.trim())
		.filter(Boolean);

	if (filePaths.length === 0) {
		return failed('No changed files found for this commit');
	}

	if (filePaths.length > MAX_DIFF_FILES_FOR_SIDE_BY_SIDE) {
		return failed(
			`Commit touches ${filePaths.length} files — too many for a side-by-side view`,
		);
	}

	const tmpDir = path.join(os.tmpdir(), 'epiq', 'commit-diffs', sha);

	// Preparing the temp files (git reads + writes) has no window semantics,
	// so every file can happen concurrently regardless of open order below.
	const preparedFiles = await Promise.all(
		filePaths.map(async (filePath, index) => {
			const [beforeContent, afterContent] = await Promise.all([
				readFileAtRevision(repoRoot, `${sha}~1`, filePath),
				readFileAtRevision(repoRoot, sha, filePath),
			]);

			// Nested under the file's own index so same-named files from
			// different directories in the same commit don't collide, while
			// still keeping each temp file's own basename (and therefore
			// extension) exactly as it is in the repo.
			const basename = path.basename(filePath);
			const beforePath = path.join(tmpDir, String(index), 'before', basename);
			const afterPath = path.join(tmpDir, String(index), 'after', basename);

			if (!existsSync(beforePath)) {
				fileManager.writeToFile(beforePath, beforeContent);
				await chmod(beforePath, 0o444);
			}

			if (!existsSync(afterPath)) {
				fileManager.writeToFile(afterPath, afterContent);
				await chmod(afterPath, 0o444);
			}

			return {beforePath, afterPath};
		}),
	);

	// Opening, unlike preparing, DOES have window semantics and must be
	// sequenced: the first tab forces a brand new VS Code window (so
	// inspecting a commit doesn't dump tabs into whatever the user already
	// has open), then every other file for this commit is told to reuse
	// whichever window is now active — which, after the settle delay below,
	// should be that same new one — so they all land together in it instead
	// of each popping open its own window.
	const [first, ...rest] = preparedFiles;
	if (!first) return failed('No changed files found for this commit');

	const firstResult = await openEditorDiffNonBlocking(
		editor,
		first.beforePath,
		first.afterPath,
		'new',
	);
	if (isFail(firstResult) || rest.length === 0) return firstResult;

	// Best-effort: there's no CLI signal for "the new window is now up and
	// focused," just a delay long enough that it usually is by the time the
	// rest fire. Worst case a --reuse-window call races this and lands in
	// the user's original window instead — annoying, but no worse than
	// today, and everything still opens.
	await new Promise(resolve => setTimeout(resolve, NEW_WINDOW_SETTLE_MS));

	const restResults = await Promise.all(
		rest.map(({beforePath, afterPath}) =>
			openEditorDiffNonBlocking(editor, beforePath, afterPath, 'reuse'),
		),
	);

	// The first (and its new window) already succeeded — a later file
	// failing to join it doesn't erase that, so this stays a success either
	// way. Just log which ones didn't make it in.
	for (const result of restResults) {
		if (isFail(result)) {
			logger.error(
				`Failed to open an additional diff tab for ${sha}: ${result.message}`,
			);
		}
	}

	return firstResult;
};

// Opens a single commit's diff, read-only, in the user's configured editor.
// Never touches the materialized state singleton — this is a pure
// inspect-the-code-history action, independent of time-travel checkout.
export const openCommitDiffInEditor = async (
	input: ToolInput & {sha: string},
): Promise<Result<true>> => {
	if (!isPlausibleSha(input.sha)) return failed('Invalid commit sha');

	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);
	const repoRoot = repoRootResult.value;

	const primaryEditor = getEditorCandidates()[0];

	if (primaryEditor && isVSCodeEditor(primaryEditor)) {
		const sideBySideResult = await openCommitAsSideBySideDiffs(
			repoRoot,
			input.sha,
			primaryEditor,
		);

		if (!isFail(sideBySideResult)) return sideBySideResult;

		logger.error(
			`Side-by-side diff failed for ${input.sha}, falling back to unified diff: ${sideBySideResult.message}`,
		);
	}

	return openCommitAsUnifiedDiff(repoRoot, input.sha);
};

// Rewinds the shared state singleton to how the board looked at `targetTime`,
// read-only. Adapted from the TUI's `checkoutBoardAt`
// (source/lib/command-line/commands/checkout-board.ts), minus the Ink-specific
// breadcrumb navigation step, which the GUI doesn't need since it derives all
// boards from state on every read rather than navigating to one.
export const checkoutStateAt = (
	input: ToolInput & {targetTime: number},
): Promise<Result<{asOfTime: number}>> =>
	runExclusive(async () => {
		const stateBranchRootResult = resolveStateBranchRoot(input.repoRoot);
		if (isFail(stateBranchRootResult)) {
			return failed(stateBranchRootResult.message);
		}

		const eventsBeforeResult = loadMergedEventsBefore(
			stateBranchRootResult.value,
			input.targetTime,
		);
		if (isFail(eventsBeforeResult)) return failed(eventsBeforeResult.message);

		const {appliedEvents, unappliedEvents} = eventsBeforeResult.value;

		const resetResult = resetState();
		if (isFail(resetResult)) return resetResult;

		const materializeResults = materializeAll(appliedEvents);
		const materializeFailures = materializeResults.filter(isFail);

		if (materializeFailures.length > 0) {
			return failed(materializeFailures.map(x => x.message).join(', '));
		}

		patchState({
			readOnly: true,
			timeMode: 'peek',
			unappliedEvents,
			replay: null,
		});

		currentAsOfTime = input.targetTime;

		return succeeded('Checked out historical state', {
			asOfTime: input.targetTime,
		});
	});

// Returns the shared state singleton to the live head. Adapted from `:peek
// now` (source/lib/command-line/commands/peek.cmd.ts).
export const returnToLive = (input: ToolInput = {}): Promise<Result<true>> =>
	runExclusive(async () => {
		const stateBranchRootResult = resolveStateBranchRoot(input.repoRoot);
		if (isFail(stateBranchRootResult)) {
			return failed(stateBranchRootResult.message);
		}

		const eventsResult = loadMergedEvents(stateBranchRootResult.value);
		if (isFail(eventsResult)) return failed(eventsResult.message);

		const resetResult = resetState();
		if (isFail(resetResult)) return resetResult;

		const materializeResults = materializeAll(eventsResult.value);
		const materializeFailures = materializeResults.filter(isFail);

		if (materializeFailures.length > 0) {
			return failed(materializeFailures.map(x => x.message).join(', '));
		}

		patchState({
			readOnly: false,
			timeMode: 'live',
			unappliedEvents: [],
			replay: null,
		});

		currentAsOfTime = null;

		return succeeded('Returned to live state', true);
	});
