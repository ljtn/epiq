import {getStateBranchRoot} from '../git/git-storage.js';
import {RepoInput, resolveRepoRoot} from '../lib/commits/commit-repo.js';
import {isWorkspaceAction} from './timeline-index.js';
import {
	loadEffectiveEventTimes,
	loadMergedEvents,
	loadMergedEventsBefore,
} from '../lib/board/board-log.js';
import {
	logSkippedEvents,
	materializeAll,
	partitionMaterializeResults,
} from '../lib/board/board-log.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {
	getState,
	isStateInitialized,
	patchState,
	resetState,
} from '../lib/state/state.js';
import {CLOSED_SWIMLANE_ID} from '../lib/board/static-ids.js';
import {
	EventTimelineEntry,
	getTimelineIndex,
	lanesOpenAt,
} from './timeline-index.js';
import {ApiTimeTravelStatus} from './api-state.model.js';

type ToolInput = RepoInput;

// Free to set high: iteration is over events, not slots, and only non-empty
// buckets are returned, so more slots only means finer resolution.
const TIMELINE_BUCKET_COUNT = 100_000;

// Above this the per-event scatter is dropped and the client falls back to
// buckets. Well clear of a normal board — this repo's whole log is ~1.2k.
const TIMELINE_EVENT_CAP = 20_000;

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
	// One entry per event, for the scatter layout: it plots each dot at its own
	// timestamp, so bucketing there only merges events that happened to land in
	// the same slot. Empty past TIMELINE_EVENT_CAP, where the scatter falls back
	// to `buckets` rather than the payload growing without bound.
	events: EventTimelineEntry[];
	// The lane of every ticket open as the window begins, by id — the ones with
	// no event inside it included, so the flow chart can run their lines across
	// a stretch nothing happened in.
	lanesAtStart: Record<string, string>;
	// Every swimlane the log ever created, by id, under its last known name —
	// for naming one the board has since deleted.
	laneNames: Record<string, string>;
	// The lane a close moves a ticket into, so the client can tell a ticket
	// sitting closed from one sitting in a lane the board no longer has.
	closedLane: string;
	earliest: number;
	latest: number;
};

// The first entry at or after `t`, or the length where none is. The entries
// are in time order, so a window is two of these and the slice between them.
const firstAtOrAfter = (entries: readonly {t: number}[], t: number): number => {
	let low = 0;
	let high = entries.length;

	while (low < high) {
		const mid = (low + high) >> 1;

		if (entries[mid]!.t < t) low = mid + 1;
		else high = mid;
	}

	return low;
};

// Pure read: never touches the materialized state singleton, so it is safe
// mid-scrub. Omit `start`/`end` for an [earliest event, now] window.
export const getEventTimeline = async (
	input: ToolInput & {start?: number; end?: number; boardId?: string} = {},
): Promise<Result<EventTimeline>> => {
	const stateBranchRootResult = resolveStateBranchRoot(input.repoRoot);
	if (isFail(stateBranchRootResult))
		return failed(stateBranchRootResult.message);

	// Derived once per state of the log and reused, which is what keeps a scrub
	// off the whole history: every step below is over the window alone.
	const indexResult = getTimelineIndex(stateBranchRootResult.value);
	if (isFail(indexResult)) return failed(indexResult.message);

	const timed = indexResult.value.entries;

	const now = Date.now();
	const windowEnd = input.end ?? now;
	// The entries are in time order, so the earliest is the first of them.
	const windowStart = input.start ?? timed[0]?.t ?? windowEnd;

	if (windowEnd <= windowStart) {
		return succeeded('Empty time window', {
			bucketMs: 0,
			buckets: [],
			events: [],
			lanesAtStart: {},
			laneNames: indexResult.value.laneNames,
			closedLane: CLOSED_SWIMLANE_ID,
			earliest: windowStart,
			latest: windowEnd,
		});
	}

	// A range over a sorted axis rather than a scan of it: at half a million
	// events the difference is the whole cost of a request.
	const from = firstAtOrAfter(timed, windowStart);
	const until = firstAtOrAfter(timed, windowEnd);

	const inWindow = timed
		.slice(from, until)
		// The board narrowing happens here, over the window, rather than over the
		// log: which board an event belongs to was settled when it was derived.
		.filter(
			entry =>
				!input.boardId ||
				entry.board === input.boardId ||
				// Belongs to every board rather than none: a claim changes who the
				// commits on all of them belong to.
				isWorkspaceAction(entry.action),
		)
		.map(({board: _board, ...entry}) => entry);

	const times = inWindow.map(entry => entry.t);

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
		events: inWindow.length > TIMELINE_EVENT_CAP ? [] : inWindow,
		lanesAtStart: lanesOpenAt(
			indexResult.value.lanes,
			windowStart,
			input.boardId,
		),
		laneNames: indexResult.value.laneNames,
		closedLane: CLOSED_SWIMLANE_ID,
		earliest: windowStart,
		latest: windowEnd,
	});
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
	const {fatal, skipped} = partitionMaterializeResults(materializeResults);

	if (fatal.length > 0) {
		return failed(fatal.map(x => x.message).join(', '));
	}
	logSkippedEvents(skipped);

	patchState({
		readOnly: false,
		// Cleared alongside the flag it explains, or a later time-travel refusal
		// quotes a stale unreadable-log reason.
		readOnlyReason: undefined,
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
		const {fatal, skipped} = partitionMaterializeResults(materializeResults);

		// The reset above already emptied the singleton, so bailing out plainly
		// would leave the board gone while still reporting live.
		if (fatal.length > 0) {
			return recoverToLiveAfterFailure(
				stateBranchRootResult.value,
				fatal.map(x => x.message).join(', '),
			);
		}
		logSkippedEvents(skipped);

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

// Rewinds to just after one event in the log, so the state the checkout shows
// is the state that event produced. The cut is exclusive, hence the +1.
//
// Resolved against effective times, not the raw ULID a Log row displays: a
// poisoned far-future id is judged by the clamped time `splitEventsAtTime` will
// cut on, so the checkout lands where the scrubber's dot for it sits.
export const checkoutStateAtEvent = async (
	input: ToolInput & {eventId: string},
): Promise<Result<{asOfTime: number}>> => {
	const stateBranchRootResult = resolveStateBranchRoot(input.repoRoot);
	if (isFail(stateBranchRootResult)) {
		return failed(stateBranchRootResult.message);
	}

	// Deliberately outside `runExclusive`: `checkoutStateAt` takes that lock and
	// it is not re-entrant.
	const timesResult = loadEffectiveEventTimes(stateBranchRootResult.value);
	if (isFail(timesResult)) return failed(timesResult.message);

	const time = timesResult.value.get(input.eventId) ?? null;
	if (time === null) return failed('Event not found in the log');

	return checkoutStateAt({repoRoot: input.repoRoot, targetTime: time + 1});
};

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
