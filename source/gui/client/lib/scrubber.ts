// Everything the time scrubber computes or remembers, with no JSX. The chart
// parts and the component that arranges them draw against this.

import {useEffect, useRef, useState} from 'react';
import {
	formatDateTime,
	formatTimeOfDay,
	isSameDay,
} from '../../../lib/utils/date.utils.js';
import {maxOf, minOf} from '../../../lib/utils/minmax.js';
import {GuiCommitEntry, GuiEventTimeline} from './gui-state.model';

export const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

// ---------------------------------------------------------------- dimensions

// "even" is the "Volume" histogram, "real" the "Events" scatter.
export type LayoutMode = 'even' | 'real';

export const TRACK_HEIGHT = 24;

// Both modes must occupy the same total height or switching modes reflows the
// board content below. "Volume" is two TRACK_HEIGHT boxes plus the column's
// 8px gap; "Events" centres one taller scatter area in that same total.
const EVENTS_MODE_TOTAL_HEIGHT = 8 + TRACK_HEIGHT * 2;
export const EVENTS_SCATTER_HEIGHT = TRACK_HEIGHT + 16;
export const EVENTS_MODE_VERTICAL_PADDING =
	(EVENTS_MODE_TOTAL_HEIGHT - EVENTS_SCATTER_HEIGHT) / 2;

export const HOVER_HINT_WIDTH = 220;

// Must stay fainter than the bucket highlight drawn over it.
export const SEGMENT_HIGHLIGHT_COLOR = 'rgba(122, 158, 214, 0.07)';
export const BUCKET_HIGHLIGHT_COLOR = 'rgba(255, 255, 255, 0.06)';
export const NEEDLE_COLOR = 'rgba(255, 255, 255, 0.62)';

// Past this count a bar is ~2px, too thin to give up a pixel to the gap.
const MIN_BUCKET_COUNT_FOR_GAP = 300;

export const barWidthCss = (bucketCount: number): string =>
	bucketCount < MIN_BUCKET_COUNT_FOR_GAP
		? `calc(${100 / bucketCount}% - 1px)`
		: `${100 / bucketCount}%`;

// -------------------------------------------------------------------- buckets

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
	const commitBounds = commits.length ? commits.map(c => c.time) : [now];

	const earliest = minOf(
		commitBounds,
		timeline?.buckets[0]?.t ?? timeline?.earliest ?? now,
	);
	const latest = maxOf(commitBounds, timeline?.latest ?? now);
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
): number[] => {
	const counts = new Array<number>(axis.bucketCount).fill(0);

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

// Finest first — chooseSegmentUnit relies on the order.
const SEGMENT_UNIT_ORDER = ['day', 'week', 'month', 'year'] as const;
export type SegmentUnit = (typeof SEGMENT_UNIT_ORDER)[number];

const APPROX_UNIT_MS: Record<SegmentUnit, number> = {
	day: 24 * 60 * 60 * 1000,
	week: 7 * 24 * 60 * 60 * 1000,
	month: 30.44 * 24 * 60 * 60 * 1000,
	year: 365.25 * 24 * 60 * 60 * 1000,
};

// Kept above 30 so a month's view lands comfortably on days instead of flipping
// unit between runs with slightly different spans.
const MAX_SEGMENTS = 35;

export const chooseSegmentUnit = (spanMs: number): SegmentUnit =>
	SEGMENT_UNIT_ORDER.find(
		unit => spanMs / APPROX_UNIT_MS[unit] <= MAX_SEGMENTS,
	) ?? 'year';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec',
];

const advanceByUnit = (date: Date, unit: SegmentUnit): void => {
	if (unit === 'day') date.setDate(date.getDate() + 1);
	else if (unit === 'week') date.setDate(date.getDate() + 7);
	else if (unit === 'month') date.setMonth(date.getMonth() + 1);
	else date.setFullYear(date.getFullYear() + 1);
};

export type Segment = {start: number; end: number; label: string};

// Stepping via the Date setters rather than millisecond arithmetic is what
// keeps midnight at midnight across DST, where a day is 23 or 25 hours long.
export const segmentAt = (time: number, unit: SegmentUnit): Segment => {
	const start = new Date(time);
	start.setHours(0, 0, 0, 0);

	if (unit === 'week') {
		// Snap back to Monday (getDay is Sunday-based, so rotate it).
		start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
	} else if (unit === 'month') {
		start.setDate(1);
	} else if (unit === 'year') {
		start.setMonth(0, 1);
	}

	const end = new Date(start);
	advanceByUnit(end, unit);

	// The last moment inside the period, not the first after it — labelling a
	// week as "10 – 17 Aug" would wrongly imply 8 days.
	const lastDay = new Date(end.getTime() - 1);

	const label =
		unit === 'day'
			? `${WEEKDAY_LABELS[start.getDay()]} ${start.getDate()} ${
					MONTH_LABELS[start.getMonth()]
			  }`
			: unit === 'week'
			? start.getMonth() === lastDay.getMonth()
				? `${start.getDate()}–${lastDay.getDate()} ${
						MONTH_LABELS[start.getMonth()]
				  }`
				: `${start.getDate()} ${
						MONTH_LABELS[start.getMonth()]
				  } – ${lastDay.getDate()} ${MONTH_LABELS[lastDay.getMonth()]}`
			: unit === 'month'
			? `${MONTH_LABELS[start.getMonth()]} ${start.getFullYear()}`
			: `${start.getFullYear()}`;

	return {start: start.getTime(), end: end.getTime(), label};
};

export const formatInterval = (start: number, end: number): string => {
	const startDate = new Date(start);
	const endDate = new Date(end);

	const endLabel = isSameDay(startDate, endDate)
		? formatTimeOfDay(endDate)
		: formatDateTime(endDate);

	return `${formatDateTime(startDate)} – ${endLabel}`;
};

// --------------------------------------------------------------------- scope

export type Scope = 'all' | 'week' | 'month' | 'year';

export type PeriodRange = {start: number; end: number};

export const SCOPES: readonly Scope[] = ['week', 'month', 'year', 'all'];

const SCOPE_DURATION_MS: Record<Exclude<Scope, 'all'>, number> = {
	week: 7 * 24 * 60 * 60 * 1000,
	month: 30 * 24 * 60 * 60 * 1000,
	year: 365 * 24 * 60 * 60 * 1000,
};

export const isScope = (value: string | null): value is Scope =>
	(SCOPES as readonly string[]).includes(value ?? '');

export const getPeriodRange = (
	scope: Scope,
	offset: number,
): PeriodRange | null => {
	if (scope === 'all') return null;

	const durationMs = SCOPE_DURATION_MS[scope];
	const end = Date.now() - offset * durationMs;

	return {start: end - durationMs, end};
};

export const formatPeriodLabel = (
	scope: Scope,
	offset: number,
	range: PeriodRange | null,
): string => {
	if (scope === 'all' || !range) return 'All time';

	if (offset === 0) {
		return scope === 'week'
			? 'Last 7 days'
			: scope === 'month'
			? 'Last 30 days'
			: 'Last 365 days';
	}

	const start = new Date(range.start);
	const end = new Date(range.end);

	return `${start.getMonth() + 1}/${start.getDate()} – ${
		end.getMonth() + 1
	}/${end.getDate()}`;
};

export const scopeButtonLabel = (scope: Scope): string =>
	scope === 'all' ? 'All' : scope[0]!.toUpperCase() + scope.slice(1);

// ---------------------------------------------------------------- animations

// Must be deterministic per point: Math.random() would reshuffle on every
// re-render, and the scrubber re-renders on hover.
const hashUnitInterval = (key: string): number => {
	let hash = 2166136261;

	for (let index = 0; index < key.length; index++) {
		hash ^= key.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}

	return ((hash >>> 0) % 10000) / 10000;
};

const DOT_APPEAR_MS = 260;
const DOT_APPEAR_SCATTER_MS = 620;

const dotDelayMs = (key: string) =>
	Math.round(hashUnitInterval(key) * DOT_APPEAR_SCATTER_MS);

export const dotAppearAnimation = (key: string): string =>
	`epiqScrubberTwinkle ${DOT_APPEAR_MS}ms ease-out ${dotDelayMs(
		key,
	)}ms backwards`;

// The mirrored delay is what unwinds the scatter the way it was drawn: the dot
// that twinkled in last is the first to retract.
//
// Its own keyframes rather than the twinkle with `direction: reverse` — under
// `reverse` Chrome fills the delay with the `from` frame, so every dot sits at
// scale 0 while it waits and the whole series blinks out at once. `both` on a
// forward animation holds full scale through the wait and zero afterwards,
// which also stops a dot popping back before it is unmounted.
export const dotExitAnimation = (key: string): string =>
	`epiqScrubberRetract ${DOT_APPEAR_MS}ms ease-in ${
		DOT_APPEAR_SCATTER_MS - dotDelayMs(key)
	}ms both`;

// The last dot to leave finishes here, so nothing may unmount before it.
export const DOT_EXIT_TOTAL_MS = DOT_APPEAR_SCATTER_MS + DOT_APPEAR_MS;

// The sweep must stay well longer than one bar's growth, or the crest
// dissolves into everything-at-once.
const BAR_GROW_MS = 200;
const BAR_GROW_SWEEP_MS = 560;

// `backwards` is required, or a bar sits at full height until its delay elapses
// and then snaps to zero.
export const barGrowAnimation = (
	index: number,
	firstIndex: number,
	lastIndex: number,
): string => {
	const span = lastIndex - firstIndex;
	const delay =
		span > 0 ? ((index - firstIndex) / span) * BAR_GROW_SWEEP_MS : 0;

	return `epiqScrubberGrow ${BAR_GROW_MS}ms ease-out ${delay.toFixed(
		0,
	)}ms backwards`;
};

// The whole sweep, after which a newly mounted bar is no longer part of the
// entrance.
export const BAR_ENTRANCE_TOTAL_MS = BAR_GROW_MS + BAR_GROW_SWEEP_MS;

// Belongs on the series wrapper, never on the individual bars or dots: those
// are keyed by bucket time, so a scope change remounts each one and the fade
// restarts per element as a full-chart flash.
export const FADE_IN_ANIMATION = 'epiqScrubberFadeIn 320ms ease-out';

// The one exception to this codebase's inline-style-only convention:
// @keyframes cannot be expressed as a React style object.
export const SCRUBBER_KEYFRAMES = `
	/* Must animate the standalone 'scale' property, not 'transform': the dots
	   carry a 'transform: translate(...)' to centre themselves, and animating
	   'transform' would replace it and fling them off position. */
	@keyframes epiqScrubberTwinkle {
		from { scale: 0; }
		to { scale: 1; }
	}

	/* Not the twinkle reversed — see dotExitAnimation for why. */
	@keyframes epiqScrubberRetract {
		from { scale: 1; }
		to { scale: 0; }
	}

	@keyframes epiqScrubberGrow {
		from { transform: scaleY(0); }
		to { transform: scaleY(1); }
	}

	@keyframes epiqScrubberFadeIn {
		/* Starts faint rather than transparent: from zero the whole chart reads
		   as blinking on a mere data refresh. */
		from { opacity: 0.2; }
		to { opacity: 1; }
	}
`;

// --------------------------------------------------------------------- state

// Gated in JS rather than by a stylesheet media query because the animations it
// guards are inline styles, which a stylesheet can only beat with !important.
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export const usePrefersReducedMotion = (): boolean => {
	const [reduced, setReduced] = useState(
		() => window.matchMedia(REDUCED_MOTION_QUERY).matches,
	);

	useEffect(() => {
		const query = window.matchMedia(REDUCED_MOTION_QUERY);
		const onChange = () => setReduced(query.matches);

		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	}, []);

	return reduced;
};

export type SeriesPresence = {mounted: boolean; leaving: boolean};

// Unticking a series has to outlive the render that hid it, or its dots vanish
// instead of retracting. `durationMs` of 0 skips the wait entirely, which is
// how reduced motion and the bar charts opt out.
export const useExitTransition = (
	visible: boolean,
	durationMs: number,
): SeriesPresence => {
	const [mounted, setMounted] = useState(visible);
	const [leaving, setLeaving] = useState(false);
	// Compared against, rather than depended on: the effect must run only when
	// the flag actually flips, so a series hidden on first paint never plays an
	// exit it was never visible for.
	const wasVisible = useRef(visible);
	// Read through a ref so a duration change cannot re-run the effect. It
	// would clear the running timeout, hit the guard above, and never reschedule
	// — stranding the series mounted and invisible.
	const duration = useRef(durationMs);
	duration.current = durationMs;

	useEffect(() => {
		if (visible === wasVisible.current) return;
		wasVisible.current = visible;

		if (visible) {
			setLeaving(false);
			setMounted(true);
			return;
		}

		if (duration.current === 0) {
			setMounted(false);
			return;
		}

		setLeaving(true);

		const timeout = setTimeout(() => {
			setLeaving(false);
			setMounted(false);
		}, duration.current);

		// Re-ticking mid-exit cancels it, so the dots never finish leaving.
		return () => clearTimeout(timeout);
	}, [visible]);

	return {mounted, leaving};
};

// Only an explicit stored value overrides the fallback, so a series that
// defaults to on stays on until somebody turns it off.
export const usePersistedFlag = (
	key: string,
	fallback: boolean,
): [boolean, (next: boolean) => void] => {
	const [value, setValue] = useState(() => {
		const stored = localStorage.getItem(key);
		return stored === null ? fallback : stored === 'true';
	});

	return [
		value,
		(next: boolean) => {
			setValue(next);
			localStorage.setItem(key, String(next));
		},
	];
};
