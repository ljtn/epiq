import {maxOf, minOf} from '../../../../lib/utils/minmax.js';
import {GuiCommitEntry, GuiEventTimeline} from '../gui-state.model';
import {clamp} from './layout';
import {BoardView} from './categories';
import {isShown} from './dots';

const DAY_MS = 24 * 60 * 60 * 1000;

// The ceiling stops a long span producing sub-pixel bars and thousands of
// nodes.
const MIN_TIME_BUCKETS = 60;
const MAX_TIME_BUCKETS = 900;

// Sub-linear on purpose, so bars thin out as you zoom out instead of silently
// swallowing larger intervals. The coefficient and exponent are the curve
// through two chosen anchors: ~220 buckets at 7 days, ~800 at 365.
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

	// The scope's own range, which the server returns as earliest/latest. Taking
	// it from the data instead would draw a week's worth of events across a
	// window labelled a month.
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

// Re-aggregated rather than rendering the server's buckets directly: those are
// sparse, so using them as display slots gives every bar a different real
// duration.
export const bucketIssueCounts = (
	axis: ScrubberAxis,
	timeline: GuiEventTimeline | null,
	view: BoardView = 'all',
	hiddenIds: ReadonlySet<string> = new Set(),
	issueOnly: string | null = null,
): number[] => {
	const counts = new Array<number>(axis.bucketCount).fill(0);

	// Counted off the events where they exist, since only they carry the action,
	// identity and ticket a filter needs. The buckets cannot be filtered — they
	// arrive pre-summed across every kind — so past the server's cap the filter
	// has nothing to act on and everything is counted.
	if (timeline && timeline.events.length > 0) {
		for (const entry of timeline.events) {
			if (!isShown(entry, view, hiddenIds, issueOnly)) continue;

			counts[axis.bucketIndexForTime(entry.t)]! += 1;
		}

		return counts;
	}

	for (const sparseBucket of timeline?.buckets ?? []) {
		counts[axis.bucketIndexForTime(sparseBucket.t)]! += sparseBucket.count;
	}

	return counts;
};

export type CommitBucketStats = {count: number; linesChanged: number};

// Must use the same buckets as the issue histogram, or the mirrored halves stop
// lining up. Bucketing is by containment, never nearest-neighbour: a bucket's
// contents have to be exactly what happened inside its own window.
export const bucketCommitStats = (
	axis: ScrubberAxis,
	commits: GuiCommitEntry[],
): Map<number, CommitBucketStats> => {
	const byIndex = new Map<number, CommitBucketStats>();

	for (const commit of commits) {
		const index = axis.bucketIndexForTime(commit.time);
		const existing = byIndex.get(index) ?? {count: 0, linesChanged: 0};

		byIndex.set(index, {
			count: existing.count + 1,
			linesChanged: existing.linesChanged + commit.linesChanged,
		});
	}

	return byIndex;
};

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
