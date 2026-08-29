// Everything the time scrubber computes or remembers, with no JSX. The chart
// parts and the component that arranges them draw against this.

import {useEffect, useMemo, useRef, useState} from 'react';
import {
	formatDateTime,
	formatTimeOfDay,
	isSameDay,
} from '../../../lib/utils/date.utils.js';
import {maxOf, minOf} from '../../../lib/utils/minmax.js';
import {
	GuiCommitEntry,
	GuiEventIdentity,
	GuiEventTimeline,
	GuiEventTimelineEntry,
} from './gui-state.model';
import {EVENT_CATEGORY_COLORS, GUI_THEME} from './gui-theme';

export const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

// ---------------------------------------------------------------- dimensions

// "even" is the "Volume" histogram, "real" the "Events" scatter.
export type LayoutMode = 'even' | 'real';

export const isLayoutMode = (value: string | null): value is LayoutMode =>
	value === 'even' || value === 'real';

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
export const SEGMENT_HIGHLIGHT_COLOR = 'rgba(122, 157, 214, 0.14)';
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
): number[] => {
	const counts = new Array<number>(axis.bucketCount).fill(0);

	// Counted off the events where they exist, since only they carry the action
	// and identity a filter needs. The buckets cannot be filtered — they arrive
	// pre-summed across every kind — so past the server's cap the filter has
	// nothing to act on and everything is counted.
	if (timeline && timeline.events.length > 0) {
		for (const entry of timeline.events) {
			if (!isShown(entry, view, hiddenIds)) continue;

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

export const EVENT_CATEGORIES = [
	'tickets',
	'comments',
	'tagging',
	'assigning',
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

// What the Board series is showing. 'all' draws every kind and colours by kind;
// picking one kind draws only it and colours by the identity behind each event.
// Exactly one at a time, which is what keeps a colour from meaning two things.
export type BoardView = 'all' | EventCategory;

export const BOARD_VIEWS: BoardView[] = ['all', ...EVENT_CATEGORIES];

export const isBoardView = (value: unknown): value is BoardView =>
	BOARD_VIEWS.includes(value as BoardView);

// One place for the series colour, so the bars, the baseline and the filter's
// own rows cannot drift apart.
export const boardViewColor = (view: BoardView): string =>
	view === 'all' ? GUI_THEME.accent : EVENT_CATEGORY_COLORS[view];

// Which side of the event a view colours by. Tickets has none — every event is
// somebody changing a ticket, so it stays the plain Board accent.
export const identityAxisFor = (
	view: BoardView,
): 'actor' | 'tag' | 'assignee' | null =>
	view === 'comments'
		? 'actor'
		: view === 'tagging'
		? 'tag'
		: view === 'assigning'
		? 'assignee'
		: null;

// Listed rather than matched on substrings: "attachment" and "assignee" both
// read as near-misses for the tag and comment rules, and a wrong bucket here is
// invisible until someone counts.
const CATEGORY_BY_ACTION: Record<string, EventCategory> = {
	'add.issue.comment': 'comments',
	'edit.issue.comment': 'comments',
	'delete.issue.comment': 'comments',
	'add.issue.tag': 'tagging',
	'remove.issue.tag': 'tagging',
	'create.tag': 'tagging',
	'tombstone.tag': 'tagging',
	'restore.tag': 'tagging',
	'add.issue.assignee': 'assigning',
	'remove.issue.assignee': 'assigning',
	'create.contributor': 'assigning',
	'rename.contributor': 'assigning',
	'tombstone.contributor': 'assigning',
	'restore.contributor': 'assigning',
	'link.contributor.user': 'assigning',
};

// Everything else is a change to a ticket or to the board holding it.
export const categoryOf = (action: string): EventCategory =>
	CATEGORY_BY_ACTION[action] ?? 'tickets';

// The identity a view colours by, or null where the event has none — an
// assigning view over a `create.contributor`, say.
export const identityOf = (
	entry: GuiEventTimelineEntry,
	view: BoardView,
): GuiEventIdentity | null => {
	const axis = identityAxisFor(view);
	return axis === null ? null : entry[axis];
};

// Every identity present in the window under this view, in first-seen order.
// Doubles as the filter's legend, so it lists what is actually there rather
// than every tag or contributor the repo has ever had.
export const listIdentities = (
	timeline: GuiEventTimeline | null,
	view: BoardView,
): GuiEventIdentity[] => {
	if (!timeline || identityAxisFor(view) === null) return [];

	const byId = new Map<string, GuiEventIdentity>();

	for (const entry of timeline.events) {
		if (categoryOf(entry.action) !== view) continue;

		const identity = identityOf(entry, view);
		if (identity && !byId.has(identity.id)) byId.set(identity.id, identity);
	}

	return [...byId.values()];
};

// The one identity left when everything else in the view is hidden — reached by
// unchecking down to one, or in a click via "only". Narrowed that far the series
// no longer stands for a kind, it stands for that tag or person, so the bars and
// the label take its colour and its name rather than the kind's.
export const soleVisibleIdentity = (
	identities: GuiEventIdentity[],
	hiddenIds: ReadonlySet<string>,
): GuiEventIdentity | null => {
	const visible = identities.filter(identity => !hiddenIds.has(identity.id));
	return visible.length === 1 ? visible[0]! : null;
};

export type EventDot = {
	key: string;
	// The event this dot stands for. null on the bucketed fallback, whose dot
	// stands for a slot rather than one event.
	id: string | null;
	t: number;
	// null on a per-event dot, where the dot *is* the event. Set only on the
	// bucketed fallback, whose dot stands for a slot that may hold several.
	count: number | null;
	// The event's own description on a per-event dot, null on the fallback.
	label: string | null;
	// null on the fallback, whose bucket mixes categories with no way to tell
	// them apart. Drawn in the plain Board accent there.
	category: EventCategory | null;
	// Resolved here rather than by the renderer, which would otherwise need to
	// know which of the three colour rules applies.
	color: string;
	// What the dot is coloured by under the current view, for its hint.
	identity: GuiEventIdentity | null;
	size: number;
	opacity: number;
};

// What a dot says when hovered. The identity is appended only where the label
// does not already carry it: "Tagged with bug" names its tag, "Commented" does
// not name its author.
export const dotDetail = (dot: EventDot): string => {
	const base =
		dot.label ?? `${dot.count ?? 0} board event${dot.count === 1 ? '' : 's'}`;

	return dot.identity && !base.includes(dot.identity.name)
		? `${base} — ${dot.identity.name}`
		: base;
};

// Fixed, because a per-event dot has no count to encode. Matches the commit
// scatter, which has always been one dot per commit.
const EVENT_DOT_SIZE = 4;
const EVENT_DOT_OPACITY = 0.55;

// The scatter plots each dot at its own timestamp, so it wants events, not
// buckets. Buckets are the fallback for a window the server capped, and only
// there do size and opacity carry a count.
// An event is drawn when its kind matches the view and the identity it would be
// coloured by has not been unticked. An event with no identity under this view
// always shows: there is nothing in the list for the user to have hidden it by.
const isShown = (
	entry: GuiEventTimelineEntry,
	view: BoardView,
	hiddenIds: ReadonlySet<string>,
): boolean => {
	if (view !== 'all' && categoryOf(entry.action) !== view) return false;

	const identity = identityOf(entry, view);

	return identity === null || !hiddenIds.has(identity.id);
};

export const buildEventDots = (
	timeline: GuiEventTimeline | null,
	view: BoardView = 'all',
	hiddenIds: ReadonlySet<string> = new Set(),
): EventDot[] => {
	if (!timeline) return [];

	if (timeline.events.length > 0) {
		return timeline.events.flatMap((entry, index) => {
			if (!isShown(entry, view, hiddenIds)) return [];

			const category = categoryOf(entry.action);
			const identity = identityOf(entry, view);

			return [
				{
					// Two events can share a millisecond, so time alone is not a key.
					key: `${entry.t}-${index}`,
					id: entry.id,
					t: entry.t,
					count: null,
					label: entry.label,
					category,
					color:
						view === 'all'
							? EVENT_CATEGORY_COLORS[category]
							: identity?.color ?? GUI_THEME.accent,
					identity,
					size: EVENT_DOT_SIZE,
					opacity: EVENT_DOT_OPACITY,
				},
			];
		});
	}

	const maxCount = maxOf(
		timeline.buckets.map(bucket => bucket.count),
		1,
	);

	return timeline.buckets.map(bucket => {
		const intensity = bucket.count / maxCount;

		return {
			key: String(bucket.t),
			id: null,
			t: bucket.t,
			count: bucket.count,
			label: null,
			category: null,
			color: GUI_THEME.accent,
			identity: null,
			size: 3 + intensity * 6,
			opacity: 0.3 + intensity * 0.5,
		};
	});
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
const SEGMENT_UNIT_ORDER = [
	'minute',
	'hour',
	'day',
	'week',
	'month',
	'year',
] as const;
export type SegmentUnit = (typeof SEGMENT_UNIT_ORDER)[number];

const APPROX_UNIT_MS: Record<SegmentUnit, number> = {
	minute: 60 * 1000,
	hour: 60 * 60 * 1000,
	day: 24 * 60 * 60 * 1000,
	week: 7 * 24 * 60 * 60 * 1000,
	month: 30.44 * 24 * 60 * 60 * 1000,
	year: 365.25 * 24 * 60 * 60 * 1000,
};

// Kept above 30 so a month's view lands comfortably on days instead of flipping
// unit between runs with slightly different spans.
const MAX_SEGMENTS = 35;

// A unit this coarse for the span leaves the track as one block, which tells
// the reader nothing. Only the hour scope reaches it; every other span yields
// seven segments or more.
const MIN_SEGMENTS = 2;

export const chooseSegmentUnit = (spanMs: number): SegmentUnit => {
	const index = SEGMENT_UNIT_ORDER.findIndex(
		unit => spanMs / APPROX_UNIT_MS[unit] <= MAX_SEGMENTS,
	);
	if (index === -1) return 'year';

	const chosen = SEGMENT_UNIT_ORDER[index]!;
	if (spanMs / APPROX_UNIT_MS[chosen] >= MIN_SEGMENTS) return chosen;

	return SEGMENT_UNIT_ORDER[Math.max(0, index - 1)]!;
};

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
	if (unit === 'minute') date.setMinutes(date.getMinutes() + 1);
	else if (unit === 'hour') date.setHours(date.getHours() + 1);
	else if (unit === 'day') date.setDate(date.getDate() + 1);
	else if (unit === 'week') date.setDate(date.getDate() + 7);
	else if (unit === 'month') date.setMonth(date.getMonth() + 1);
	else date.setFullYear(date.getFullYear() + 1);
};

export type Segment = {start: number; end: number; label: string};

// Stepping via the Date setters rather than millisecond arithmetic is what
// keeps midnight at midnight across DST, where a day is 23 or 25 hours long.
export const segmentAt = (time: number, unit: SegmentUnit): Segment => {
	const start = new Date(time);

	// Each unit clears everything below it; day and coarser snap to midnight.
	if (unit === 'minute') start.setSeconds(0, 0);
	else if (unit === 'hour') start.setMinutes(0, 0, 0);
	else start.setHours(0, 0, 0, 0);

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

	const clock = (date: Date): string =>
		`${String(date.getHours()).padStart(2, '0')}:${String(
			date.getMinutes(),
		).padStart(2, '0')}`;

	const label =
		unit === 'minute'
			? clock(start)
			: unit === 'hour'
			? `${WEEKDAY_LABELS[start.getDay()]} ${String(start.getHours()).padStart(
					2,
					'0',
			  )}:00`
			: unit === 'day'
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

export type Scope = 'all' | 'hour' | 'day' | 'week' | 'month' | 'year';

export type PeriodRange = {start: number; end: number};

export const SCOPES: readonly Scope[] = [
	'hour',
	'day',
	'week',
	'month',
	'year',
	'all',
];

const SCOPE_DURATION_MS: Record<Exclude<Scope, 'all'>, number> = {
	hour: 60 * 60 * 1000,
	day: 24 * 60 * 60 * 1000,
	week: 7 * 24 * 60 * 60 * 1000,
	month: 30 * 24 * 60 * 60 * 1000,
	year: 365 * 24 * 60 * 60 * 1000,
};

// Every window is a rolling one ending now, so these read as durations back
// from now rather than as calendar periods.
const SCOPE_RECENT_LABELS: Record<Exclude<Scope, 'all'>, string> = {
	hour: 'Last hour',
	day: 'Last 24 hours',
	week: 'Last 7 days',
	month: 'Last 30 days',
	year: 'Last 365 days',
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

	if (offset === 0) return SCOPE_RECENT_LABELS[scope];

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

// The same stagger the CSS animation applies, as a number the canvas can draw
// with: 0 before this dot's turn, 1 once it has fully arrived.
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number) => t * t * t;

export const dotEntranceScale = (key: string, elapsedMs: number): number =>
	easeOutCubic(clamp((elapsedMs - dotDelayMs(key)) / DOT_APPEAR_MS, 0, 1));

// The mirror of the entrance, so a series unwinds the way it was drawn: the
// dot that twinkled in last is the first to retract.
export const dotExitScale = (key: string, elapsedMs: number): number =>
	1 -
	easeInCubic(
		clamp(
			(elapsedMs - (DOT_APPEAR_SCATTER_MS - dotDelayMs(key))) / DOT_APPEAR_MS,
			0,
			1,
		),
	);

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

	// Stable identity: the memos that hang off this feed the scatter canvas,
	// which repaints every dot when its layers change.
	return useMemo(() => ({mounted, leaving}), [mounted, leaving]);
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

// ---------------------------------------------------------------- board filter

// What the scrubber's selection means for the board below it. Null when the
// selection narrows nothing, so the board is left alone.
export type BoardFilter = {
	axis: 'actor' | 'tag' | 'assignee';
	visibleIds: ReadonlySet<string>;
};

// Only a narrowed selection filters the board. A kind with everything still
// ticked is a colouring choice, not a question about which tickets matter.
export const buildBoardFilter = (
	view: BoardView,
	only: readonly string[] | null,
): BoardFilter | null => {
	const axis = identityAxisFor(view);
	if (axis === null || only === null) return null;

	return {axis, visibleIds: new Set(only)};
};

// Read off the board's own state, which is already the state at the needle —
// so a filtered board answers "who/what, as of here", matching the moment the
// scrubber is parked on rather than the events inside the window.
export const issuePassesBoardFilter = (
	issue: {
		id: string;
		tags: {id: string}[];
		assignees: {id: string}[];
	},
	commentAuthorIds: readonly string[],
	filter: BoardFilter | null,
): boolean => {
	if (!filter) return true;

	const ids =
		filter.axis === 'tag'
			? issue.tags.map(tag => tag.id)
			: filter.axis === 'assignee'
			? issue.assignees.map(assignee => assignee.id)
			: commentAuthorIds;

	return ids.some(id => filter.visibleIds.has(id));
};
