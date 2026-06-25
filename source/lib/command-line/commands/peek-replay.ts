import {getEventTime} from '../../event/date-utils.js';
import {AppEvent} from '../../event/event.model.js';
import {describeEvent} from '../../event/format-log-utils.js';
import {
	getAffectedNodeIds,
	materialize,
} from '../../event/event-materialize.js';
import {Mode} from '../../model/action-map.model.js';
import {isFail} from '../../model/result-types.js';
import {getState, patchState} from '../../state/state.js';

// A replay animates the board forward from a historical checkout to the live
// edge over roughly this window, regardless of how many events are involved.
const REPLAY_DURATION_MS = 10_000;

// Fixed number of frames across the window. Each frame advances a virtual
// "playback clock" and applies every event due by then, so a burst of activity
// lands in a single frame while quiet stretches simply fast-forward.
const FRAME_COUNT = 60;

// Floor on the tick interval so we never schedule faster than the terminal can
// reasonably repaint.
const MIN_INTERVAL_MS = 16;

let replayTimer: ReturnType<typeof setInterval> | null = null;

export const isReplayActive = (): boolean => replayTimer !== null;

// Stop any running replay. Safe to call when nothing is replaying. Callers that
// want to leave replay mode are responsible for patching `timeMode` themselves
// (e.g. `:peek now`); this only tears down the timer.
export const cancelActiveReplay = (): void => {
	if (replayTimer !== null) {
		clearInterval(replayTimer);
		replayTimer = null;
	}
};

// Land back in normal, editable, live mode once the movie catches up to now (or
// if it has to bail). All events have been materialized at this point, so the
// board already matches the live head.
const finishReplay = (): void => {
	cancelActiveReplay();

	patchState({
		mode: Mode.DEFAULT,
		readOnly: false,
		timeMode: 'live',
		unappliedEvents: [],
		replay: null,
		// Restore a selection so navigation re-engages immediately once the user is
		// handed control back (replay starts with nothing selected).
		selectedIndex: 0,
	});
};

// Build the normalized [0..1] position at which each event should have played.
// Inter-event gaps are weighted by their square root so long idle stretches
// compress (a month-long gap costs far less than 30 day-long ones) while bursts
// of rapid edits keep their relative spacing — quiet periods fast-forward,
// crunch weeks burst. Falls back to even spacing when timestamps are identical.
const buildPlaybackFractions = (times: number[]): number[] => {
	const cumulative: number[] = [];
	let acc = 0;

	for (let i = 0; i < times.length; i++) {
		const gap = i === 0 ? 0 : Math.max(0, times[i]! - times[i - 1]!);
		acc += Math.sqrt(gap);
		cumulative[i] = acc;
	}

	const total = acc;

	return cumulative.map((value, i) =>
		total > 0 ? value / total : (i + 1) / times.length,
	);
};

// Drive the forward replay. `events` are the (causally ordered) events that
// occurred after `startTime`; the caller has already checked out the board at
// `startTime` and made it read-only. We re-apply the events in time-compressed
// frames, patching progress, a caption, and the flashed node ids each frame so
// the topbar and board can visualize it.
export const startReplay = ({
	events,
	startTime,
}: {
	events: AppEvent[];
	startTime: number;
}): void => {
	cancelActiveReplay();

	const totalCount = events.length;
	const times = events.map(event => getEventTime(event) ?? startTime);
	const endTime = times[totalCount - 1] ?? Date.now();
	const fractions = buildPlaybackFractions(times);

	const intervalMs = Math.max(
		Math.round(REPLAY_DURATION_MS / FRAME_COUNT),
		MIN_INTERVAL_MS,
	);

	let frame = 0;
	let cursor = 0;

	patchState({
		mode: Mode.DEFAULT,
		readOnly: true,
		timeMode: 'replay',
		unappliedEvents: events,
		replay: {
			progress: 0,
			appliedCount: 0,
			totalCount,
			currentTime: startTime,
			startTime,
			endTime,
			currentLabel: '',
			flashNodeIds: [],
		},
	});

	replayTimer = setInterval(() => {
		frame++;
		const progress = frame / FRAME_COUNT;

		const flashNodeIds: string[] = [];
		let lastApplied: AppEvent | undefined;

		// Apply every event whose scheduled position has been reached this frame.
		while (cursor < totalCount && fractions[cursor]! <= progress) {
			const event = events[cursor]!;
			const result = materialize(event);

			if (isFail(result)) {
				// A real, already-persisted event failed to re-apply. Stop the movie
				// rather than risk leaving an inconsistent board on screen, and hand
				// control back to the live, editable head.
				finishReplay();
				return;
			}

			flashNodeIds.push(...getAffectedNodeIds(event));
			lastApplied = event;
			cursor++;
		}

		if (cursor >= totalCount || frame >= FRAME_COUNT) {
			// Flush any stragglers left by rounding, then finish on the live head.
			for (; cursor < totalCount; cursor++) {
				const result = materialize(events[cursor]!);

				if (isFail(result)) break;
			}

			finishReplay();
			return;
		}

		const previous = getState().replay;

		patchState({
			unappliedEvents: events.slice(cursor),
			replay: {
				// Drive the scrubber off elapsed time, not events applied, so it keeps
				// advancing smoothly across idle frames where nothing materializes.
				progress: Math.min(1, progress),
				appliedCount: cursor,
				totalCount,
				startTime,
				endTime,
				// On idle fast-forward frames (no event applied) keep showing the last
				// event's caption, time, and spotlight rather than blanking out.
				currentTime: lastApplied
					? getEventTime(lastApplied) ?? previous?.currentTime ?? startTime
					: previous?.currentTime ?? startTime,
				currentLabel: lastApplied
					? describeEvent(lastApplied)
					: previous?.currentLabel ?? '',
				flashNodeIds: lastApplied
					? [...new Set(flashNodeIds)]
					: previous?.flashNodeIds ?? [],
			},
		});
	}, intervalMs);
};
