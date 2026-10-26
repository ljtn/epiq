import {getEventTime, toEffectiveUlidTimes} from '../../event/date-utils.js';
import {AppEvent} from '../../board/board-events.model.js';
import {describeEvent} from '../../board/format-log-utils.js';
import {isConvergenceFail, materialize} from '../../board/board-log.js';
import {getAffectedNodeIds} from '../../board/board-replay.js';
import {Mode} from '../../model/action-map.model.js';
import {isFail} from '../../model/result-types.js';
import {buildPlaybackFractions} from '../../utils/playback-pacing.js';
import {getState, patchState} from '../../state/state.js';

// Target frame rate for the movie.
const TARGET_FPS = 20;

// Floor on the tick interval so we never schedule faster than the terminal can
// reasonably repaint.
const MIN_INTERVAL_MS = 16;

// Holds a full bar briefly at the end so it visibly completes.
const COMPLETION_HOLD_MS = 150;

let replayTimer: ReturnType<typeof setInterval> | null = null;
let completionTimer: ReturnType<typeof setTimeout> | null = null;

export const isReplayActive = (): boolean => replayTimer !== null;

// Stops any running replay's timers; callers patch `timeMode` themselves.
export const cancelActiveReplay = (): void => {
	if (replayTimer !== null) {
		clearInterval(replayTimer);
		replayTimer = null;
	}

	if (completionTimer !== null) {
		clearTimeout(completionTimer);
		completionTimer = null;
	}
};

// Back to live, editable mode once the movie catches up or bails.
const finishReplay = (): void => {
	cancelActiveReplay();

	patchState({
		mode: Mode.DEFAULT,
		readOnly: false,
		// Cleared alongside the flag it explains, or a later time-travel refusal
		// quotes a stale unreadable-log reason.
		readOnlyReason: undefined,
		timeMode: 'live',
		unappliedEvents: [],
		replay: null,
		// Restore a selection so navigation re-engages immediately once the user is
		// handed control back (replay starts with nothing selected).
		selectedIndex: 0,
	});
};

// Re-applies the causally ordered events after `startTime` in time-compressed
// frames, patching progress, caption and flashed nodes. The caller has checked out the board.
export const startReplay = ({
	events,
	startTime,
	durationMs,
}: {
	events: AppEvent[];
	startTime: number;
	// How long the whole movie should take to animate forward to the live edge,
	// regardless of how many events are involved.
	durationMs: number;
}): void => {
	cancelActiveReplay();

	const totalCount = events.length;
	// Effective times, so one poisoned far-future id cannot swallow the whole
	// playback budget in a single gap.
	const times = toEffectiveUlidTimes(
		events.map(event => getEventTime(event)),
	).map(time => time ?? startTime);
	const endTime = times[totalCount - 1] ?? Date.now();
	const fractions = buildPlaybackFractions(times);

	// Derive the frame count from the duration so the tick rate stays at ~TARGET_FPS
	// no matter how long the movie runs, then clamp the interval to the repaint floor.
	const frameCount = Math.max(1, Math.round((durationMs * TARGET_FPS) / 1000));
	const intervalMs = Math.max(
		Math.round(durationMs / frameCount),
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
		const progress = frame / frameCount;

		const flashNodeIds: string[] = [];
		let lastApplied: AppEvent | undefined;
		let lastAppliedTime: number | undefined;

		// Apply every event whose scheduled position has been reached this frame.
		while (cursor < totalCount && fractions[cursor]! <= progress) {
			const event = events[cursor]!;
			const result = materialize(event);

			if (isFail(result)) {
				// Lost a race in the merged log: skipped, as live replay does.
				if (isConvergenceFail(result)) {
					cursor++;
					continue;
				}

				// A real event failed to re-apply: stop and return to the live head.
				finishReplay();
				return;
			}

			flashNodeIds.push(...getAffectedNodeIds(event));
			lastApplied = event;
			lastAppliedTime = times[cursor];
			cursor++;
		}

		if (cursor >= totalCount || frame >= frameCount) {
			// Flush any stragglers left by rounding.
			for (; cursor < totalCount; cursor++) {
				const result = materialize(events[cursor]!);

				if (isFail(result) && !isConvergenceFail(result)) break;
			}

			// The last event can land short of 100%, so snap to full and hold a beat.
			const previous = getState().replay;

			patchState({
				unappliedEvents: [],
				replay: previous
					? {...previous, progress: 1, appliedCount: totalCount}
					: previous,
			});

			cancelActiveReplay();
			completionTimer = setTimeout(finishReplay, COMPLETION_HOLD_MS);
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
					? lastAppliedTime ?? previous?.currentTime ?? startTime
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
