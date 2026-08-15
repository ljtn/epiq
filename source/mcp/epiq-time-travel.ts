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
import {AppEvent} from '../lib/event/event.model.js';
import {
	loadMergedEvents,
	loadMergedEventsBefore,
} from '../lib/event/event-load.js';
import {materializeAll} from '../lib/event/event-materialize.js';
import {minOf} from '../lib/utils/minmax.js';
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

// Free to set high: iteration is over events, not slots, and only non-empty
// buckets are returned, so more slots only means finer resolution.
const TIMELINE_BUCKET_COUNT = 100_000;

// Not in AppState: purely GUI-server bookkeeping.
let currentAsOfTime: number | null = null;

// Serializes read-then-write of the shared state singleton across an `await`.
// NOT re-entrant: calling runExclusive from inside it deadlocks forever.
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

// The id -> parent map is built as the scan proceeds, so each event is
// attributed using the hierarchy as it stood then. No-board events are dropped.
export const filterEventsForBoard = (
	events: AppEvent[],
	boardId: string,
): AppEvent[] => {
	const parentById = new Map<string, string>();
	const boardIds = new Set<string>();

	const resolveBoard = (id: string): string | null => {
		const seen = new Set<string>();
		let current: string | undefined = id;

		while (current && !seen.has(current)) {
			if (boardIds.has(current)) return current;
			seen.add(current);
			current = parentById.get(current);
		}

		return null;
	};

	const matching: AppEvent[] = [];

	for (const event of events) {
		const payload = event.payload as {id?: string; parent?: string};
		const id = payload?.id;
		if (!id) continue;

		// Before matching, so a board's own add event is attributed to it.
		if (event.action === 'add.board') {
			boardIds.add(id);
		}

		if (payload.parent) {
			parentById.set(id, payload.parent);
		}

		if (id === boardId || resolveBoard(id) === boardId) {
			matching.push(event);
		}
	}

	return matching;
};

// Pure read: never touches the materialized state singleton, so it is safe
// mid-scrub. Omit `start`/`end` for an [earliest event, now] window.
export const getEventTimeline = async (
	input: ToolInput & {start?: number; end?: number; boardId?: string} = {},
): Promise<Result<EventTimeline>> => {
	const stateBranchRootResult = resolveStateBranchRoot(input.repoRoot);
	if (isFail(stateBranchRootResult))
		return failed(stateBranchRootResult.message);

	const eventsResult = loadMergedEvents(stateBranchRootResult.value);
	if (isFail(eventsResult)) return failed(eventsResult.message);

	const scopedEvents = input.boardId
		? filterEventsForBoard(eventsResult.value, input.boardId)
		: eventsResult.value;

	const allTimes = scopedEvents
		.map(getEventTime)
		.filter((t): t is number => t !== null);

	const now = Date.now();
	const windowEnd = input.end ?? now;
	// Folded, not spread: `allTimes` can hold one entry per event in the whole log.
	const windowStart = input.start ?? minOf(allTimes, windowEnd);

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
	linesChanged: number;
};

// Non-printable, so a commit subject can never contain them.
const GIT_LOG_FIELD_SEP = '\x1f';
const GIT_LOG_RECORD_SEP = '\x1e';

// Pure read of the *code* repo's history, safe mid-scrub. `--not <stateBranch>`
// is required: worktrees share one ref namespace, so epiq's own state commits
// would otherwise appear mixed into real development history.
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
			'--shortstat',
			`--format=${GIT_LOG_RECORD_SEP}%H${GIT_LOG_FIELD_SEP}%at${GIT_LOG_FIELD_SEP}%an${GIT_LOG_FIELD_SEP}%s`,
		],
	});

	if (isFail(logResult)) return failed(logResult.message);

	const commits = logResult.value.stdout
		.split(GIT_LOG_RECORD_SEP)
		.filter(record => record.trim().length > 0)
		.map((record): CommitEntry | null => {
			const [headerLine, ...statLines] = record.split('\n');
			const [sha, atSeconds, author, ...subjectParts] = (
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
				subject: subjectParts.join(GIT_LOG_FIELD_SEP),
				linesChanged: insertions + deletions,
			};
		})
		.filter((commit): commit is CommitEntry => commit !== null);

	return succeeded('Computed commit timeline', commits);
};

// `sha` reaches a `git show <sha>` argv slot, where a leading `-` would be read
// as a flag. Argument injection, not shell injection.
const isPlausibleSha = (sha: string): boolean => /^[0-9a-f]{7,40}$/i.test(sha);

// Fallback: editors highlight the +/- lines but not the code's own language.
const openCommitAsUnifiedDiff = async (
	repoRoot: string,
	sha: string,
): Promise<Result<true>> => {
	const showResult = await execGit({cwd: repoRoot, args: ['show', sha]});
	if (isFail(showResult)) return failed(showResult.message);

	const tmpDir = path.join(os.tmpdir(), 'epiq', 'commit-diffs');
	fileManager.mkDir(tmpDir);

	const tmpPath = path.join(tmpDir, `${sha}.diff`);

	// Already chmod 0o444 after the first write, so re-writing would fail EACCES.
	if (!existsSync(tmpPath)) {
		fileManager.writeToFile(tmpPath, showResult.value.stdout);
		await chmod(tmpPath, 0o444);
	}

	return openEditorOnFileNonBlocking(tmpPath);
};

// Beyond this, dozens of tabs (one editor spawn each) is worse than one diff.
const MAX_DIFF_FILES_FOR_SIDE_BY_SIDE = 12;

// No CLI signal for "the new window is up", so just long enough to outlast it.
const NEW_WINDOW_SETTLE_MS = 800;

// A missing blob only means the file was added or deleted here, not a failure.
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

// Each side keeps its real filename so the editor detects the language.
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

	const preparedFiles = await Promise.all(
		filePaths.map(async (filePath, index) => {
			const [beforeContent, afterContent] = await Promise.all([
				readFileAtRevision(repoRoot, `${sha}~1`, filePath),
				readFileAtRevision(repoRoot, sha, filePath),
			]);

			// Indexed so same-named files from different directories don't collide.
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

	// Must be sequenced: the first tab forces a new window, and the rest reuse
	// whichever window is active — after the settle delay below, that new one.
	const [first, ...rest] = preparedFiles;
	if (!first) return failed('No changed files found for this commit');

	const firstResult = await openEditorDiffNonBlocking(
		editor,
		first.beforePath,
		first.afterPath,
		'new',
	);
	if (isFail(firstResult) || rest.length === 0) return firstResult;

	await new Promise(resolve => setTimeout(resolve, NEW_WINDOW_SETTLE_MS));

	const restResults = await Promise.all(
		rest.map(({beforePath, afterPath}) =>
			openEditorDiffNonBlocking(editor, beforePath, afterPath, 'reuse'),
		),
	);

	for (const result of restResults) {
		if (isFail(result)) {
			logger.error(
				`Failed to open an additional diff tab for ${sha}: ${result.message}`,
			);
		}
	}

	return firstResult;
};

// Never touches the materialized state singleton, so it is independent of any
// time-travel checkout.
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

// Takes NO lock: its callers already run inside `runExclusive`, which is not
// re-entrant, so taking it here would deadlock forever.
const restoreLiveState = (stateBranchRoot: string): Result<true> => {
	const eventsResult = loadMergedEvents(stateBranchRoot);
	if (isFail(eventsResult)) return failed(eventsResult.message);

	const resetResult = resetState();
	if (isFail(resetResult)) return failed(resetResult.message);

	// Cleared here, not at the end: past the reset the singleton's flags already
	// say live, so no exit below may leave an as-of time claiming a checkout.
	currentAsOfTime = null;

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

	return succeeded('Restored live state', true);
};

// For failure paths where `resetState()` has already emptied the singleton while
// its flags claim live — mutation guards would be wide open over a board that is
// not there. Degrade to a real live state instead of leaving a phantom checkout.
const recoverToLiveAfterFailure = (
	stateBranchRoot: string,
	originalMessage: string,
): Result<never> => {
	currentAsOfTime = null;

	const restoreResult = restoreLiveState(stateBranchRoot);

	// Original failure leads; the recovery failure trails it as context.
	if (isFail(restoreResult)) {
		return failed(
			`${originalMessage} (recovery to live also failed: ${restoreResult.message})`,
		);
	}

	return failed(originalMessage);
};

// Rewinds the shared state singleton to `targetTime`, read-only.
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

		// The reset above already emptied the singleton, so bailing out plainly
		// would leave the board gone while still reporting live.
		if (materializeFailures.length > 0) {
			return recoverToLiveAfterFailure(
				stateBranchRootResult.value,
				materializeFailures.map(x => x.message).join(', '),
			);
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

export const returnToLive = (input: ToolInput = {}): Promise<Result<true>> =>
	runExclusive(async () => {
		const stateBranchRootResult = resolveStateBranchRoot(input.repoRoot);
		if (isFail(stateBranchRootResult)) {
			return failed(stateBranchRootResult.message);
		}

		const restoreResult = restoreLiveState(stateBranchRootResult.value);
		if (isFail(restoreResult)) return failed(restoreResult.message);

		return succeeded('Returned to live state', true);
	});
