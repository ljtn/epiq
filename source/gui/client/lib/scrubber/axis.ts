import {maxOf, minOf} from '../../../../lib/utils/minmax.js';
import {GuiCommitEntry, GuiEventTimeline} from '../gui-state.model';
import {clamp} from './layout';
import {BoardView, isShown} from './series';

const DAY_MS = 24 * 60 * 60 * 1000;

// The ceiling stops a long span producing sub-pixel bars and thousands of
// nodes.
const MIN_TIME_BUCKETS = 60;
const MAX_TIME_BUCKETS = 900;

// Sub-linear, so bars thin out as you zoom out: ~220 buckets at 7 days, ~800 at 365.
export const bucketCountForSpan = (spanMs: number): number => {
	const days = Math.max(1, spanMs / DAY_MS);

	return Math.round(
		clamp(116.5 * Math.pow(days, 0.3265), MIN_TIME_BUCKETS, MAX_TIME_BUCKETS),
	);
};

export type ScrubberAxis = {
	earliest: number;
	latest: number;
	span: number;
	bucketCount: number;
	bucketMs: number;
	bucketIndexForTime: (time: number) => number;
	bucketTimeAt: (index: number) => number;
	fractionForTime: (time: number) => number;
	fractionToTime: (fraction: number) => number;
};

// The one axis both series are drawn against, derived from the two together so
// a half-updated pair cannot put the charts on different scales.
export const buildAxis = (
	timeline: GuiEventTimeline | null,
	commits: GuiCommitEntry[],
	now: number = Date.now(),
): ScrubberAxis => {
	// Must stay folded, not spread: in "All time" this is one argument per
	// commit in the repository, and engines cap argument count.
	const commitTimes = commits.map(c => c.time);

	// The scope's own range, not the data's, so a month window spans a month.
	const windowStart = timeline?.earliest ?? minOf(commitTimes, now);
	const windowEnd = timeline?.latest ?? maxOf(commitTimes, now);

	// Commits come back clamped to the same window, so this cannot widen a
	// scoped axis — it only covers "All time", where the two disagree.
	const earliest = minOf(commitTimes, windowStart);
	const latest = maxOf(commitTimes, windowEnd);
	const span = Math.max(1, latest - earliest);

	const bucketCount = bucketCountForSpan(span);
	const bucketMs = span / bucketCount;

	return {
		earliest,
		latest,
		span,
		bucketCount,
		bucketMs,
		bucketIndexForTime: time =>
			clamp(Math.floor((time - earliest) / bucketMs), 0, bucketCount - 1),
		bucketTimeAt: index => earliest + index * bucketMs,
		fractionForTime: time => clamp((time - earliest) / span, 0, 1),
		fractionToTime: fraction =>
			Math.round(earliest + clamp(fraction, 0, 1) * span),
	};
};

// False before the first window arrives, when every fraction maps to now.
export const isScrubbable = (axis: ScrubberAxis): boolean => axis.span > 1;

// Re-aggregated, since the server's sparse buckets have uneven durations.
export const bucketIssueCounts = (
	axis: ScrubberAxis,
	timeline: GuiEventTimeline | null,
	view: BoardView = 'all',
	hiddenIds: ReadonlySet<string> = new Set(),
	keptIssues: ReadonlySet<string> | null = null,
): number[] => {
	const counts = new Array<number>(axis.bucketCount).fill(0);

	// Only events can be filtered; past the server's cap, buckets count everything.
	if (timeline && timeline.events.length > 0) {
		for (const entry of timeline.events) {
			if (!isShown(entry, view, hiddenIds, keptIssues)) continue;

			counts[axis.bucketIndexForTime(entry.t)]! += 1;
		}

		return counts;
	}

	for (const sparseBucket of timeline?.buckets ?? []) {
		counts[axis.bucketIndexForTime(sparseBucket.t)]! += sparseBucket.count;
	}

	return counts;
};

export type CommitBucketStats = {
	count: number;
	linesChanged: number;
	// Kept apart as well as summed, for the measure that draws them against
	// each other rather than as one figure.
	insertions: number;
	deletions: number;
};

// Same buckets as the issue histogram, so the mirrored halves line up; by containment, never nearest.
export const bucketCommitStats = (
	axis: ScrubberAxis,
	commits: readonly GuiCommitEntry[],
): Map<number, CommitBucketStats> => {
	const byIndex = new Map<number, CommitBucketStats>();

	for (const commit of commits) {
		const index = axis.bucketIndexForTime(commit.time);
		const existing = byIndex.get(index) ?? {
			count: 0,
			linesChanged: 0,
			insertions: 0,
			deletions: 0,
		};

		byIndex.set(index, {
			count: existing.count + 1,
			linesChanged: existing.linesChanged + commit.linesChanged,
			insertions: existing.insertions + commit.insertions,
			deletions: existing.deletions + commit.deletions,
		});
	}

	return byIndex;
};

// A bar's height as a share of the track, log-scaled against the largest bucket.
export const logShare = (value: number, max: number): number =>
	value <= 0 ? 0 : Math.min(1, Math.log1p(value) / Math.log1p(max));

export type VolumeBar = {index: number; intensity: number};

// The drawn span, so the growth sweep runs across bars that exist rather than
// across empty leading and trailing stretches.
export const populatedRange = (bars: VolumeBar[]): [number, number] =>
	bars.length > 0
		? [
				bars.reduce((min, bar) => Math.min(min, bar.index), Infinity),
				bars.reduce((max, bar) => Math.max(max, bar.index), -Infinity),
		  ]
		: [0, 0];

// "Events" mode's y-axis: 0 at 00:00 (top) to just under 1 at 23:59. Both
// series must share this scale for their heights to be comparable.
export const hourFractionForTime = (time: number): number => {
	const date = new Date(time);
	return (date.getHours() * 60 + date.getMinutes()) / (24 * 60);
};

// ------------------------------------------------------------------- segments
