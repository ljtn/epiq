import {getStateBranchRoot} from '../git/git-storage.js';
import {getEventTime} from '../lib/event/date-utils.js';
import {
	loadMergedEvents,
	loadMergedEventsBefore,
} from '../lib/event/event-load.js';
import {materializeAll} from '../lib/event/event-materialize.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
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
