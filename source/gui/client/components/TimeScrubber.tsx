import {useEffect, useRef, useState} from 'react';
import {
	GuiCommitEntry,
	GuiEventTimeline,
	GuiEventTimelineBucket,
	GuiTimeTravelStatus,
} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {IconChevronDown} from './IconChevronDown';
import {IconChevronRight} from './IconChevronRight';
import {Checkbox} from './Checkbox';
import {Panel} from './Panel';
import {maxOf, minOf} from '../../../lib/utils/minmax.js';
import {
	formatDateTime,
	formatTimeOfDay,
	isSameDay,
} from '../../../lib/utils/date.utils.js';

const formatInterval = (start: number, end: number): string => {
	const startDate = new Date(start);
	const endDate = new Date(end);

	const endLabel = isSameDay(startDate, endDate)
		? formatTimeOfDay(endDate)
		: formatDateTime(endDate);

	return `${formatDateTime(startDate)} – ${endLabel}`;
};

type TimeScrubberProps = {
	timeline: GuiEventTimeline | null;
	commits: GuiCommitEntry[];
	timeTravel: GuiTimeTravelStatus;
	onScrub: (targetTime: number) => void;
	onReturnToLive: () => void;
	// Undefined start/end asks for the default "all time" window. Both series
	// must come from one call: they share an axis derived from both, so
	// independent fetches can put a half-updated pair on screen.
	onRequestHistory: (start?: number, end?: number, allBoards?: boolean) => void;
	boardId: string | null;
	connected: boolean;
	onInspectCommit: (sha: string) => void;
};

// "even" is the "Volume" histogram, "real" the "Events" scatter.
type LayoutMode = 'even' | 'real';

type Scope = 'all' | 'week' | 'month' | 'year';

type PeriodRange = {start: number; end: number};

const SCRUB_THROTTLE_MS = 120;

const TRACK_HEIGHT = 24;

// Both modes must occupy the same total height or switching modes reflows the
// board content below. "Volume" is two TRACK_HEIGHT boxes plus the column's
// 8px gap; "Events" centres one taller scatter area in that same total.
const EVENTS_MODE_TOTAL_HEIGHT = 8 + TRACK_HEIGHT * 2;
const EVENTS_SCATTER_HEIGHT = TRACK_HEIGHT + 16;
const EVENTS_MODE_VERTICAL_PADDING =
	(EVENTS_MODE_TOTAL_HEIGHT - EVENTS_SCATTER_HEIGHT) / 2;

// Belongs on the series wrapper, never on the individual bars or dots: those
// are keyed by bucket time, so a scope change remounts each one and the fade
// restarts per element as a full-chart flash.
const FADE_IN_ANIMATION = 'epiqScrubberFadeIn 320ms ease-out';

// Must be deterministic per point: Math.random() would reshuffle on every
// re-render, and this component re-renders on hover.
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

const dotAppearAnimation = (key: string): string =>
	`epiqScrubberTwinkle ${DOT_APPEAR_MS}ms ease-out ${Math.round(
		hashUnitInterval(key) * DOT_APPEAR_SCATTER_MS,
	)}ms backwards`;

// The sweep must stay well longer than one bar's growth, or the crest
// dissolves into everything-at-once.
const BAR_GROW_MS = 200;
const BAR_GROW_SWEEP_MS = 560;

// `backwards` is required, or a bar sits at full height until its delay
// elapses and then snaps to zero.
const barGrowAnimation = (
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

const HOVER_HINT_WIDTH = 220;

// Gated in JS rather than by a stylesheet media query because the animations
// are inline styles, which a stylesheet can only beat with !important.
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const usePrefersReducedMotion = (): boolean => {
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

const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

const DAY_MS = 24 * 60 * 60 * 1000;

// The ceiling stops a long span producing sub-pixel bars and thousands of
// nodes.
const MIN_TIME_BUCKETS = 60;
const MAX_TIME_BUCKETS = 900;

// Sub-linear on purpose, so bars thin out as you zoom out instead of silently
// swallowing larger intervals. The coefficient and exponent are the curve
// through two chosen anchors: ~220 buckets at 7 days, ~800 at 365.
const bucketCountForSpan = (spanMs: number): number => {
	const days = Math.max(1, spanMs / DAY_MS);

	return Math.round(
		clamp(116.5 * Math.pow(days, 0.3265), MIN_TIME_BUCKETS, MAX_TIME_BUCKETS),
	);
};

// Past this count a bar is ~2px, too thin to give up a pixel to the gap.
const MIN_BUCKET_COUNT_FOR_GAP = 300;

// Must stay fainter than the bucket highlight drawn over it.
const SEGMENT_HIGHLIGHT_COLOR = 'rgba(122, 158, 214, 0.07)';

const NEEDLE_COLOR = 'rgba(255, 255, 255, 0.62)';

// Finest first — chooseSegmentUnit relies on the order.
const SEGMENT_UNIT_ORDER = ['day', 'week', 'month', 'year'] as const;
type SegmentUnit = (typeof SEGMENT_UNIT_ORDER)[number];

const APPROX_UNIT_MS: Record<SegmentUnit, number> = {
	day: 24 * 60 * 60 * 1000,
	week: 7 * 24 * 60 * 60 * 1000,
	month: 30.44 * 24 * 60 * 60 * 1000,
	year: 365.25 * 24 * 60 * 60 * 1000,
};

// Kept above 30 so a month's view lands comfortably on days instead of
// flipping unit between runs with slightly different spans.
const MAX_SEGMENTS = 35;

const chooseSegmentUnit = (spanMs: number): SegmentUnit =>
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

// Stepping via the Date setters rather than millisecond arithmetic is what
// keeps midnight at midnight across DST, where a day is 23 or 25 hours long.
const segmentAt = (
	time: number,
	unit: SegmentUnit,
): {start: number; end: number; label: string} => {
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

const toggleButtonStyle = (active: boolean): React.CSSProperties => ({
	background: 'transparent',
	border: `1px solid ${active ? GUI_THEME.accent : GUI_THEME.dim}`,
	color: active ? GUI_THEME.accent : GUI_THEME.dim,
	borderRadius: 6,
	fontSize: 10,
	padding: '2px 8px',
	cursor: 'pointer',
});

const navButtonStyle: React.CSSProperties = {
	background: 'transparent',
	border: `1px solid ${GUI_THEME.dim}`,
	color: GUI_THEME.dim,
	borderRadius: 6,
	fontSize: 10,
	padding: '2px 6px',
	cursor: 'pointer',
	lineHeight: 1,
};

const COLLAPSED_STORAGE_KEY = 'epiq.timeScrubber.collapsed';
const SCOPE_STORAGE_KEY = 'epiq.timeScrubber.scope';
const SHOW_ISSUES_STORAGE_KEY = 'epiq.timeScrubber.showIssues';
const SHOW_COMMITS_STORAGE_KEY = 'epiq.timeScrubber.showCommits';
const ALL_BOARDS_STORAGE_KEY = 'epiq.timeScrubber.allBoards';

// Both series default to on, so only an explicit "false" turns one off.
const readStoredSeriesVisibility = (key: string): boolean =>
	localStorage.getItem(key) !== 'false';

const VALID_SCOPES: readonly Scope[] = ['all', 'week', 'month', 'year'];

const readStoredScope = (): Scope => {
	const stored = localStorage.getItem(SCOPE_STORAGE_KEY);
	return (VALID_SCOPES as readonly string[]).includes(stored ?? '')
		? (stored as Scope)
		: 'all';
};

const SCOPE_DURATION_MS: Record<Exclude<Scope, 'all'>, number> = {
	week: 7 * 24 * 60 * 60 * 1000,
	month: 30 * 24 * 60 * 60 * 1000,
	year: 365 * 24 * 60 * 60 * 1000,
};

const getPeriodRange = (scope: Scope, offset: number): PeriodRange | null => {
	if (scope === 'all') return null;

	const durationMs = SCOPE_DURATION_MS[scope];
	const end = Date.now() - offset * durationMs;
	const start = end - durationMs;

	return {start, end};
};

const formatPeriodLabel = (
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

export const TimeScrubber = ({
	timeline,
	commits,
	timeTravel,
	onScrub,
	onReturnToLive,
	onRequestHistory,
	boardId,
	connected,
	onInspectCommit,
}: TimeScrubberProps) => {
	const reducedMotion = usePrefersReducedMotion();
	const trackRef = useRef<HTMLDivElement | null>(null);
	const lastDispatchRef = useRef(0);
	const [layoutMode, setLayoutMode] = useState<LayoutMode>('even');
	const [scope, setScope] = useState<Scope>(readStoredScope);
	const [offset, setOffset] = useState(0);
	const [dragFraction, setDragFraction] = useState<number | null>(null);
	const [hoverLabel, setHoverLabel] = useState<{
		time: string;
		count: number;
		t: number;
	} | null>(null);
	const [hoveredBucketFraction, setHoveredBucketFraction] = useState<
		number | null
	>(null);
	// Pointer position regardless of whether a plotted point sits under it, so
	// the segment highlight works over empty stretches.
	const [pointerFraction, setPointerFraction] = useState<number | null>(null);
	const [needleHovered, setNeedleHovered] = useState(false);
	const [hoveredCommit, setHoveredCommit] = useState<GuiCommitEntry | null>(
		null,
	);
	const [hoveredCommitFraction, setHoveredCommitFraction] = useState<
		number | null
	>(null);
	// Resolved arithmetically from the pointer's x rather than by per-bucket hit
	// targets: at wide spans a bucket is only ~2px across.
	const [hoveredBucketIndex, setHoveredBucketIndex] = useState<number | null>(
		null,
	);
	const [hoveredCommitBucketIndex, setHoveredCommitBucketIndex] = useState<
		number | null
	>(null);
	const [collapsed, setCollapsed] = useState(
		() => localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true',
	);
	const [showIssues, setShowIssues] = useState(() =>
		readStoredSeriesVisibility(SHOW_ISSUES_STORAGE_KEY),
	);
	const [showCommits, setShowCommits] = useState(() =>
		readStoredSeriesVisibility(SHOW_COMMITS_STORAGE_KEY),
	);

	const changeShowIssues = (next: boolean) => {
		setShowIssues(next);
		localStorage.setItem(SHOW_ISSUES_STORAGE_KEY, String(next));
	};

	const changeShowCommits = (next: boolean) => {
		setShowCommits(next);
		localStorage.setItem(SHOW_COMMITS_STORAGE_KEY, String(next));
	};

	// Unlike the series toggles this changes what is fetched, not just what is
	// drawn.
	const [allBoards, setAllBoards] = useState(
		() => localStorage.getItem(ALL_BOARDS_STORAGE_KEY) === 'true',
	);

	const changeAllBoards = (next: boolean) => {
		setAllBoards(next);
		localStorage.setItem(ALL_BOARDS_STORAGE_KEY, String(next));
	};

	const toggleCollapsed = () => {
		setCollapsed(next => {
			const nextCollapsed = !next;
			localStorage.setItem(COLLAPSED_STORAGE_KEY, String(nextCollapsed));
			return nextCollapsed;
		});
	};

	const periodRange = getPeriodRange(scope, offset);

	// periodRange is derived from scope/offset each render, so it is
	// deliberately absent from the dependencies.
	useEffect(() => {
		if (!connected) return;

		onRequestHistory(periodRange?.start, periodRange?.end, allBoards);
	}, [scope, offset, boardId, allBoards, connected]);

	const changeScope = (nextScope: Scope) => {
		setScope(nextScope);
		setOffset(0);
		localStorage.setItem(SCOPE_STORAGE_KEY, nextScope);
	};

	const commitTimes = commits.map(c => c.time);

	// Must stay folded, not spread: in "All time" this is one argument per
	// commit in the repository, and engines cap argument count.
	const commitBounds = commitTimes.length ? commitTimes : [Date.now()];

	const earliest = minOf(
		commitBounds,
		timeline?.buckets[0]?.t ?? timeline?.earliest ?? Date.now(),
	);
	const latest = maxOf(commitBounds, timeline?.latest ?? Date.now());
	const span = Math.max(1, latest - earliest);

	const timeBucketCount = bucketCountForSpan(span);

	const timeBucketMs = span / timeBucketCount;

	const timeBucketIndexForTime = (time: number) =>
		clamp(Math.floor((time - earliest) / timeBucketMs), 0, timeBucketCount - 1);

	// Re-aggregated rather than rendering the server's buckets directly: those
	// are sparse, so using them as display slots gives every bar a different
	// real duration.
	const timeBuckets: GuiEventTimelineBucket[] = Array.from(
		{length: timeBucketCount},
		(_, index) => ({t: earliest + index * timeBucketMs, count: 0}),
	);
	for (const sparseBucket of timeline?.buckets ?? []) {
		const index = timeBucketIndexForTime(sparseBucket.t);
		timeBuckets[index]!.count += sparseBucket.count;
	}

	const fractionForTime = (time: number) =>
		clamp((time - earliest) / span, 0, 1);

	const segmentUnit = chooseSegmentUnit(span);

	// Must count user-driven view changes and nothing else. No data-derived key
	// works here: `latest` tracks Date.now() and a scoped window slides
	// continuously, so the entrance animation would replay on every refresh.
	const [animationGeneration, setAnimationGeneration] = useState(0);
	const hasData = timeline !== null;

	useEffect(() => {
		setAnimationGeneration(generation => generation + 1);
	}, [scope, offset, boardId, allBoards, layoutMode, hasData]);

	// Callers must prefix this with the series name: the issue and commit
	// wrappers are siblings, so a bare key collides and leaves stale marks on
	// screen.
	const windowKey = `${animationGeneration}`;

	// "Events" mode's y-axis: 0 at 00:00 (top) to just under 1 at 23:59. Both
	// series must share this scale for their heights to be comparable.
	const hourFractionForTime = (time: number) => {
		const date = new Date(time);
		return (date.getHours() * 60 + date.getMinutes()) / (24 * 60);
	};

	const confirmedFraction =
		timeTravel.mode === 'scrub' && timeTravel.asOfTime !== null
			? fractionForTime(timeTravel.asOfTime)
			: 1;

	const thumbFraction = dragFraction ?? confirmedFraction;

	const fractionToTime = (fraction: number) =>
		Math.round(earliest + clamp(fraction, 0, 1) * span);

	const fractionFromClientX = (clientX: number) => {
		const track = trackRef.current;
		if (!track) return 0;

		const rect = track.getBoundingClientRect();
		return clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
	};

	const dispatchScrub = (fraction: number, force: boolean) => {
		const now = Date.now();
		if (!force && now - lastDispatchRef.current < SCRUB_THROTTLE_MS) return;

		lastDispatchRef.current = now;
		onScrub(fractionToTime(fraction));
	};

	const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		event.currentTarget.setPointerCapture(event.pointerId);

		const fraction = fractionFromClientX(event.clientX);
		setDragFraction(fraction);
		dispatchScrub(fraction, true);
	};

	const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		if (dragFraction === null) return;

		const fraction = fractionFromClientX(event.clientX);
		setDragFraction(fraction);
		dispatchScrub(fraction, false);
	};

	// Measures `event.currentTarget`, not trackRef, so one handler serves both
	// the issue track and the mirrored commit box.
	const bucketIndexFromEvent = (
		event: React.MouseEvent<HTMLDivElement>,
	): number => {
		const rect = event.currentTarget.getBoundingClientRect();
		const fraction = clamp(
			(event.clientX - rect.left) / Math.max(1, rect.width),
			0,
			1,
		);

		return clamp(
			Math.floor(fraction * timeBucketCount),
			0,
			timeBucketCount - 1,
		);
	};

	const fractionFromEvent = (event: React.MouseEvent<HTMLDivElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();

		return clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
	};

	const endDrag = () => {
		if (dragFraction === null) return;

		dispatchScrub(dragFraction, true);
		setDragFraction(null);
	};

	// Two maxima, because a coarse bucket's count is a sum of many fine ones;
	// normalizing both modes against one max flattens the other.
	const maxIssueBucketCount = Math.max(1, ...timeBuckets.map(b => b.count));
	const maxIssueEventCount = Math.max(
		1,
		...(timeline?.buckets ?? []).map(b => b.count),
	);

	// Must use the same buckets as the issue histogram, or the mirrored halves
	// stop lining up. Bucketing is by containment, never nearest-neighbour: a
	// bucket's contents have to be exactly what happened inside its own window.
	const commitStatsByTimeBucketIndex = new Map<
		number,
		{count: number; linesChanged: number}
	>();
	for (const commit of commits) {
		const index = timeBucketIndexForTime(commit.time);
		const existing = commitStatsByTimeBucketIndex.get(index) ?? {
			count: 0,
			linesChanged: 0,
		};
		commitStatsByTimeBucketIndex.set(index, {
			count: existing.count + 1,
			linesChanged: existing.linesChanged + commit.linesChanged,
		});
	}
	const maxCommitCount = Math.max(
		1,
		...Array.from(commitStatsByTimeBucketIndex.values(), s => s.count),
	);

	const populatedRange = (indices: number[]): [number, number] =>
		indices.length > 0 ? [Math.min(...indices), Math.max(...indices)] : [0, 0];

	const [firstIssueBar, lastIssueBar] = populatedRange(
		timeBuckets.flatMap((bucket, index) => (bucket.count > 0 ? [index] : [])),
	);
	const [firstCommitBar, lastCommitBar] = populatedRange([
		...commitStatsByTimeBucketIndex.keys(),
	]);

	const hoveredBucket =
		hoveredBucketIndex !== null ? timeBuckets[hoveredBucketIndex] : undefined;
	const boardHoverLabel: {time: string; count: number} | null =
		layoutMode === 'even'
			? hoveredBucket
				? {
						time: formatInterval(
							hoveredBucket.t,
							hoveredBucket.t + timeBucketMs,
						),
						count: hoveredBucket.count,
				  }
				: null
			: hoverLabel;
	const boardHoverFraction =
		layoutMode === 'even'
			? hoveredBucketIndex !== null
				? (hoveredBucketIndex + 0.5) / timeBucketCount
				: null
			: hoveredBucketFraction;

	// Deliberately one segment for both tracks: hovering a commit lights up the
	// same day in the issue track above, which is what makes the two halves
	// read as one time grid.
	const hoveredSegmentTime =
		(layoutMode === 'even'
			? hoveredBucket?.t ??
			  (hoveredCommitBucketIndex !== null
					? timeBuckets[hoveredCommitBucketIndex]?.t
					: undefined)
			: // A hovered point wins over the raw pointer, so the highlight agrees
			  // with the tooltip's own moment.
			  hoverLabel?.t ??
			  hoveredCommit?.time ??
			  (pointerFraction !== null
					? fractionToTime(pointerFraction)
					: undefined)) ?? null;
	const hoveredSegment =
		hoveredSegmentTime !== null
			? segmentAt(hoveredSegmentTime, segmentUnit)
			: null;

	// Hints hang below the charts; floating above covers the scope/mode
	// controls, which is the context being read while pointing at something.
	const renderHoverHint = (
		content: {label: string; rows: string[]},
		stripeColor: string,
		leftPx: number,
		// An interval containing nothing. Still shown, but a shade down.
		empty = false,
	) => (
		<div
			style={{
				position: 'absolute',
				top: '100%',
				marginTop: 6,
				left: leftPx,
				width: HOVER_HINT_WIDTH,
				// Border-box so `width` matches what the clamp math assumes;
				// otherwise border and padding push the box past the track's edge.
				boxSizing: 'border-box',
				display: 'flex',
				flexDirection: 'column',
				gap: 2,
				textAlign: 'left',
				background: GUI_THEME.panel,
				border: `1px solid ${GUI_THEME.line}`,
				borderLeft: `3px solid ${empty ? GUI_THEME.dim : stripeColor}`,
				// Smaller than the 6px used elsewhere: a rounder corner clips the
				// 3px stripe into a visible wedge.
				borderRadius: 3,
				padding: '6px 10px',
				pointerEvents: 'none',
				// Above the board content this overhangs.
				zIndex: 5,
			}}
		>
			{hoveredSegment && (
				<div style={{fontSize: 10, color: GUI_THEME.dim}}>
					{hoveredSegment.label}
				</div>
			)}
			<div
				style={{
					fontSize: 11,
					fontWeight: 600,
					color: empty ? GUI_THEME.secondary : GUI_THEME.primary,
					whiteSpace: 'normal',
					wordBreak: 'break-word',
				}}
			>
				{content.label}
			</div>
			{content.rows.map((row, index) => (
				<div
					key={index}
					style={{
						fontSize: 11,
						color: empty ? GUI_THEME.dim : GUI_THEME.secondary,
						whiteSpace: 'normal',
						wordBreak: 'break-word',
					}}
				>
					{row}
				</div>
			))}
		</div>
	);

	const trackWidthPx = trackRef.current?.clientWidth ?? 0;

	const hoverHintLeftPx =
		boardHoverFraction !== null
			? clamp(
					boardHoverFraction * trackWidthPx - HOVER_HINT_WIDTH / 2,
					0,
					Math.max(0, trackWidthPx - HOVER_HINT_WIDTH),
			  )
			: 0;

	const hoveredCommitStats =
		hoveredCommitBucketIndex !== null
			? commitStatsByTimeBucketIndex.get(hoveredCommitBucketIndex)
			: undefined;
	const hoveredCommitBucketTime =
		hoveredCommitBucketIndex !== null
			? timeBuckets[hoveredCommitBucketIndex]?.t
			: undefined;
	const commitHoverLabel: {time: string; rows: string[]} | null =
		layoutMode === 'even'
			? hoveredCommitStats && hoveredCommitBucketTime !== undefined
				? {
						time: formatInterval(
							hoveredCommitBucketTime,
							hoveredCommitBucketTime + timeBucketMs,
						),
						rows: [
							`${hoveredCommitStats.count} commit${
								hoveredCommitStats.count === 1 ? '' : 's'
							}`,
							`${hoveredCommitStats.linesChanged.toLocaleString()} lines changed`,
						],
				  }
				: null
			: hoveredCommit
			? {
					time: formatDateTime(new Date(hoveredCommit.time)),
					rows: [
						hoveredCommit.subject,
						`${
							hoveredCommit.author
						} • ${hoveredCommit.linesChanged.toLocaleString()} lines`,
					],
			  }
			: null;
	const commitHoverFraction =
		layoutMode === 'even'
			? hoveredCommitBucketIndex !== null
				? (hoveredCommitBucketIndex + 0.5) / timeBucketCount
				: null
			: hoveredCommitFraction;
	const commitHintLeftPx =
		commitHoverFraction !== null
			? clamp(
					commitHoverFraction * trackWidthPx - HOVER_HINT_WIDTH / 2,
					0,
					Math.max(0, trackWidthPx - HOVER_HINT_WIDTH),
			  )
			: 0;

	return (
		<Panel
			as="div"
			borderColor={GUI_THEME.line}
			borderRadius={0}
			style={{
				borderLeft: 'none',
				borderRight: 'none',
				borderTop: 'none',
				padding: '10px 30px',
				// Panel clips children to keep its glow inside its rounded corners,
				// which would lop off the overhanging hint. Safe to disable only
				// because this panel is square.
				overflow: 'visible',
			}}
		>
			{/* The one exception to this codebase's inline-style-only convention:
			    @keyframes cannot be expressed as a React style object. */}
			<style>{`
				/* Must animate the standalone 'scale' property, not 'transform': the
				   dots carry a 'transform: translate(...)' to centre themselves, and
				   animating 'transform' would replace it and fling them off
				   position. */
				@keyframes epiqScrubberTwinkle {
					from { scale: 0; }
					to { scale: 1; }
				}

				@keyframes epiqScrubberGrow {
					from { transform: scaleY(0); }
					to { transform: scaleY(1); }
				}

				@keyframes epiqScrubberFadeIn {
					/* Starts faint rather than transparent: from zero the whole chart
					   reads as blinking on a mere data refresh. */
					from { opacity: 0.2; }
					to { opacity: 1; }
				}
			`}</style>

			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					gap: collapsed ? 0 : 8,
				}}
			>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						// Fixed whether or not the banner renders, so the track below
						// never shifts vertically.
						minHeight: 22,
					}}
				>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 8,
							fontSize: 11,
							whiteSpace: 'nowrap',
						}}
					>
						<button
							onClick={toggleCollapsed}
							title={collapsed ? 'Show time travel' : 'Hide time travel'}
							style={{
								background: 'transparent',
								border: 'none',
								color: GUI_THEME.dim,
								fontSize: 11,
								padding: 0,
								cursor: 'pointer',
								display: 'flex',
								alignItems: 'center',
								gap: 4,
							}}
						>
							{'Time travel'}
							{collapsed ? (
								<IconChevronRight size={12} />
							) : (
								<IconChevronDown size={12} />
							)}
						</button>

						{/* Stays visible while collapsed: that the board is read-only
						    history must never be hidden. */}
						{timeTravel.mode === 'scrub' && (
							<>
								<span style={{color: GUI_THEME.accent, fontWeight: 700}}>
									Read-only
								</span>
								<span style={{color: GUI_THEME.primary}}>
									{timeTravel.asOfTime
										? formatDateTime(new Date(timeTravel.asOfTime))
										: ''}
								</span>
							</>
						)}
					</div>

					{!collapsed && (
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: 12,
							}}
						>
							<div style={{display: 'flex', alignItems: 'center', gap: 6}}>
								{scope !== 'all' && (
									<div style={{display: 'flex', alignItems: 'center', gap: 2}}>
										<button
											title="Earlier"
											onClick={() => setOffset(o => o + 1)}
											style={navButtonStyle}
										>
											◀
										</button>
										<span
											style={{
												fontSize: 10,
												color: GUI_THEME.dim,
												whiteSpace: 'nowrap',
												overflow: 'hidden',
												// Fixed, not min, so the changing label never shifts
												// the buttons around it.
												width: 88,
												flexShrink: 0,
												textAlign: 'center',
											}}
										>
											{formatPeriodLabel(scope, offset, periodRange)}
										</span>
										<button
											title="Later"
											disabled={offset === 0}
											onClick={() => setOffset(o => Math.max(0, o - 1))}
											style={{
												...navButtonStyle,
												opacity: offset === 0 ? 0.35 : 1,
												cursor: offset === 0 ? 'default' : 'pointer',
											}}
										>
											▶
										</button>
									</div>
								)}

								<div style={{display: 'flex', gap: 2}}>
									{(['week', 'month', 'year', 'all'] as const).map(s => (
										<button
											key={s}
											onClick={() => changeScope(s)}
											style={toggleButtonStyle(scope === s)}
										>
											{s === 'all' ? 'All' : s[0]!.toUpperCase() + s.slice(1)}
										</button>
									))}
								</div>
							</div>

							<div style={{display: 'flex', gap: 2}}>
								<button
									title="How much happened, per equal-width period — no empty gaps for quiet stretches"
									onClick={() => setLayoutMode('even')}
									style={toggleButtonStyle(layoutMode === 'even')}
								>
									Volume
								</button>
								<button
									title="Individual events by exact moment — x is elapsed time, y is time of day"
									onClick={() => setLayoutMode('real')}
									style={toggleButtonStyle(layoutMode === 'real')}
								>
									Events
								</button>
							</div>

							<div style={{display: 'flex', gap: 10}}>
								<Checkbox
									label="Board"
									checked={showIssues}
									activeColor={GUI_THEME.accent}
									onChange={changeShowIssues}
								/>
								<Checkbox
									label="Code"
									checked={showCommits}
									activeColor={GUI_THEME.green}
									onChange={changeShowCommits}
								/>
								<Checkbox
									label="All boards"
									checked={allBoards}
									activeColor={GUI_THEME.accent}
									onChange={changeAllBoards}
								/>
							</div>

							<div
								style={{
									display: 'flex',
									justifyContent: 'flex-end',
									alignItems: 'center',
									// Fixed, not min, so swapping between "Now" and "Return to
									// live" never resizes the controls row.
									width: 100,
									flexShrink: 0,
								}}
							>
								{timeTravel.mode === 'scrub' ? (
									<button
										onClick={onReturnToLive}
										style={{
											background: 'transparent',
											border: `1px solid ${GUI_THEME.accent}`,
											color: GUI_THEME.accent,
											borderRadius: 6,
											fontSize: 11,
											padding: '2px 8px',
											cursor: 'pointer',
											whiteSpace: 'nowrap',
										}}
									>
										Return to live
									</button>
								) : (
									<span
										style={{
											fontSize: 11,
											color: GUI_THEME.dim,
											overflow: 'hidden',
											textAlign: 'right',
											whiteSpace: 'nowrap',
										}}
									>
										{scope === 'all' || offset === 0
											? 'Now'
											: formatDateTime(new Date(latest))}
									</span>
								)}
							</div>
						</div>
					)}
				</div>

				{!collapsed && (
					// Wraps both charts so the period highlight can be one tall block
					// spanning them and the gap between. Pointer handlers belong here
					// rather than on either chart, so a drag or hover anywhere across
					// the pair — the gap included — counts as one timeline.
					<div
						onPointerDown={onPointerDown}
						onPointerMove={onPointerMove}
						onPointerUp={endDrag}
						onPointerCancel={endDrag}
						onMouseMove={event => {
							if (layoutMode === 'even') {
								setHoveredBucketIndex(bucketIndexFromEvent(event));
								return;
							}

							setPointerFraction(fractionFromEvent(event));
						}}
						onMouseLeave={() => {
							setHoveredBucketIndex(null);
							setPointerFraction(null);
						}}
						style={{
							position: 'relative',
							display: 'flex',
							flexDirection: 'column',
							gap: 8,
							cursor: 'pointer',
						}}
					>
						{hoveredSegment && (
							<div
								style={{
									position: 'absolute',
									left: `${fractionForTime(hoveredSegment.start) * 100}%`,
									width: `${
										(fractionForTime(hoveredSegment.end) -
											fractionForTime(hoveredSegment.start)) *
										100
									}%`,
									top: 0,
									bottom: 0,
									background: SEGMENT_HIGHLIGHT_COLOR,
									pointerEvents: 'none',
									display: 'flex',
									justifyContent: 'center',
									paddingTop: 3,
									// With top and bottom both pinned, content-box would add the
									// padding on top of the resolved height and push the block
									// past the wrapper it spans.
									boxSizing: 'border-box',
									fontSize: 9,
									color: GUI_THEME.dim2,
									whiteSpace: 'nowrap',
									// The label is wider than its block at month and year
									// scopes; only one segment is ever highlighted, so it has
									// nothing to overlap.
									overflow: 'visible',
								}}
							>
								{hoveredSegment.label}
							</div>
						)}

						<div
							ref={trackRef}
							style={{
								position: 'relative',
								width: '100%',
								height:
									layoutMode === 'real' ? EVENTS_SCATTER_HEIGHT : TRACK_HEIGHT,
								paddingTop:
									layoutMode === 'real' ? EVENTS_MODE_VERTICAL_PADDING : 0,
								paddingBottom:
									layoutMode === 'real' ? EVENTS_MODE_VERTICAL_PADDING : 0,
								boxSizing: 'content-box',
								display: 'flex',
								alignItems: 'center',
							}}
						>
							<div
								style={{
									position: 'absolute',
									left: 0,
									right: 0,
									...(layoutMode === 'even' ? {bottom: 0} : {}),
									height: 2,
									borderRadius: 999,
									background: GUI_THEME.accent,
									opacity: 0.2,
								}}
							/>

							{layoutMode === 'real' && (
								<>
									<span
										style={{
											position: 'absolute',
											left: 2,
											// Absolute positioning ignores the track's padding, so
											// it has to be added back to line up with the points.
											top: EVENTS_MODE_VERTICAL_PADDING,
											fontSize: 9,
											color: GUI_THEME.dim,
											pointerEvents: 'none',
										}}
									>
										00:00
									</span>
									<span
										style={{
											position: 'absolute',
											left: 2,
											top: '50%',
											transform: 'translateY(-50%)',
											fontSize: 9,
											color: GUI_THEME.dim,
											pointerEvents: 'none',
										}}
									>
										12:00
									</span>
									<span
										style={{
											position: 'absolute',
											left: 2,
											bottom: EVENTS_MODE_VERTICAL_PADDING,
											fontSize: 9,
											color: GUI_THEME.dim,
											pointerEvents: 'none',
										}}
									>
										24:00
									</span>
								</>
							)}

							{showIssues && layoutMode === 'even' && (
								<div
									key={`issues-${layoutMode}-${windowKey}`}
									style={{
										position: 'absolute',
										inset: 0,
										pointerEvents: 'none',
										animation: reducedMotion ? undefined : FADE_IN_ANIMATION,
									}}
								>
									{/* Spans the full track height rather than the bar's, so
									    empty buckets highlight too. */}
									{hoveredBucketIndex !== null && (
										<div
											style={{
												position: 'absolute',
												left: `${
													(hoveredBucketIndex * 100) / timeBucketCount
												}%`,
												top: 0,
												bottom: 0,
												width: `${100 / timeBucketCount}%`,
												// A bucket can be thinner than a pixel at wide spans.
												minWidth: 2,
												background: 'rgba(255, 255, 255, 0.06)',
												pointerEvents: 'none',
											}}
										/>
									)}

									{timeBuckets.map((bucket, index) => {
										// Empty buckets draw nothing and stay hoverable anyway,
										// since hover is resolved arithmetically.
										if (bucket.count === 0) return null;

										const intensity = bucket.count / maxIssueBucketCount;
										const widthPercent = 100 / timeBucketCount;
										const barWidth =
											timeBucketCount < MIN_BUCKET_COUNT_FOR_GAP
												? `calc(${widthPercent}% - 1px)`
												: `${widthPercent}%`;

										return (
											<div
												key={index}
												style={{
													position: 'absolute',
													left: `${index * widthPercent}%`,
													bottom: 0,
													width: barWidth,
													height: 3 + intensity * 21,
													borderRadius: '1px 1px 0 0',
													background: GUI_THEME.accent,
													opacity: 0.35 + intensity * 0.65,
													transformOrigin: 'bottom',
													animation: reducedMotion
														? undefined
														: barGrowAnimation(
																index,
																firstIssueBar,
																lastIssueBar,
														  ),
													pointerEvents: 'none',
												}}
											/>
										);
									})}
								</div>
							)}

							{showIssues && layoutMode === 'real' && (
								<div
									key={`issues-${layoutMode}-${windowKey}`}
									style={{
										position: 'absolute',
										inset: 0,
										pointerEvents: 'none',
										animation: reducedMotion ? undefined : FADE_IN_ANIMATION,
									}}
								>
									{(timeline?.buckets ?? []).map((bucket, index) => {
										const intensity = bucket.count / maxIssueEventCount;
										const fraction = fractionForTime(bucket.t);
										const hourFraction = hourFractionForTime(bucket.t);
										const size = 3 + intensity * 6;
										const label = formatDateTime(new Date(bucket.t));

										return (
											<div
												key={index}
												title={`${bucket.count} change${
													bucket.count === 1 ? '' : 's'
												}, ${label}`}
												onMouseEnter={() => {
													setHoverLabel({
														time: label,
														count: bucket.count,
														t: bucket.t,
													});
													setHoveredBucketFraction(fraction);
												}}
												onMouseLeave={() => {
													setHoverLabel(null);
													setHoveredBucketFraction(null);
												}}
												style={{
													position: 'absolute',
													left: `${fraction * 100}%`,
													top:
														EVENTS_MODE_VERTICAL_PADDING +
														hourFraction * EVENTS_SCATTER_HEIGHT,
													width: size,
													height: size,
													borderRadius: '50%',
													background: GUI_THEME.accent,
													// Capped below 1 so overlapping points blend rather
													// than one hiding another.
													opacity: 0.3 + intensity * 0.5,
													zIndex: 2,
													transform: `translate(${-size / 2}px, -50%)`,
													animation: reducedMotion
														? undefined
														: dotAppearAnimation(String(bucket.t)),
													pointerEvents: 'auto',
												}}
											/>
										);
									})}
								</div>
							)}

							{/* Commits overlaid on the issue points' own axis. The dots
							    stopPropagation so clicking one to inspect its diff does not
							    also start a scrub-drag on the track underneath. */}
							{showCommits && layoutMode === 'real' && commits.length > 0 && (
								<div
									key={`commits-${layoutMode}-${windowKey}`}
									style={{
										position: 'absolute',
										inset: 0,
										pointerEvents: 'none',
										animation: reducedMotion ? undefined : FADE_IN_ANIMATION,
									}}
								>
									{commits.map(commit => {
										const fraction = fractionForTime(commit.time);
										const hourFraction = hourFractionForTime(commit.time);
										const size = 4;

										return (
											<div
												key={commit.sha}
												title={`${formatDateTime(new Date(commit.time))} — ${
													commit.subject
												} — ${
													commit.author
												} (${commit.linesChanged.toLocaleString()} lines)`}
												onPointerDown={event => event.stopPropagation()}
												onClick={event => {
													event.stopPropagation();
													onInspectCommit(commit.sha);
												}}
												onMouseEnter={() => {
													setHoveredCommit(commit);
													setHoveredCommitFraction(fraction);
												}}
												onMouseLeave={() => {
													setHoveredCommit(null);
													setHoveredCommitFraction(null);
												}}
												style={{
													position: 'absolute',
													left: `${fraction * 100}%`,
													top:
														EVENTS_MODE_VERTICAL_PADDING +
														hourFraction * EVENTS_SCATTER_HEIGHT,
													width: size,
													height: size,
													borderRadius: '50%',
													background: GUI_THEME.green,
													// Capped below 1 when not hovered so overlapping points
													// blend rather than one hiding another.
													opacity: hoveredCommit?.sha === commit.sha ? 1 : 0.55,
													zIndex: 1,
													transform: `translate(${-size / 2}px, -50%)`,
													animation: reducedMotion
														? undefined
														: dotAppearAnimation(commit.sha),
													pointerEvents: 'auto',
													cursor: 'pointer',
												}}
											/>
										);
									})}
								</div>
							)}
						</div>

						{showCommits && layoutMode === 'even' && commits.length > 0 && (
							<div
								key={`commits-${layoutMode}-${windowKey}`}
								// Clears the board hover and stops the move reaching the
								// wrapper, so the two hints never stack at the same spot.
								onMouseEnter={() => setHoveredBucketIndex(null)}
								onMouseMove={event => {
									event.stopPropagation();
									setHoveredCommitBucketIndex(bucketIndexFromEvent(event));
								}}
								onMouseLeave={() => setHoveredCommitBucketIndex(null)}
								style={{
									position: 'relative',
									width: '100%',
									height: TRACK_HEIGHT,
									animation: reducedMotion ? undefined : FADE_IN_ANIMATION,
								}}
							>
								<div
									style={{
										position: 'absolute',
										left: 0,
										right: 0,
										top: 0,
										height: 1,
										borderRadius: 999,
										background: GUI_THEME.green,
										opacity: 0.2,
									}}
								/>

								{hoveredCommitBucketIndex !== null && (
									<div
										style={{
											position: 'absolute',
											left: `${
												(hoveredCommitBucketIndex * 100) / timeBucketCount
											}%`,
											top: 0,
											bottom: 0,
											width: `${100 / timeBucketCount}%`,
											minWidth: 2,
											background: 'rgba(255, 255, 255, 0.06)',
											pointerEvents: 'none',
										}}
									/>
								)}

								{timeBuckets.map((bucket, index) => {
									const stats = commitStatsByTimeBucketIndex.get(index);
									if (!stats) return null;

									const intensity = stats.count / maxCommitCount;
									const widthPercent = 100 / timeBucketCount;
									const barWidth =
										timeBucketCount < MIN_BUCKET_COUNT_FOR_GAP
											? `calc(${widthPercent}% - 1px)`
											: `${widthPercent}%`;

									return (
										<div
											key={index}
											style={{
												position: 'absolute',
												left: `${index * widthPercent}%`,
												// Top-anchored, mirroring the issue bars' upward growth.
												top: 0,
												width: barWidth,
												height: 3 + intensity * 21,
												borderRadius: '0 0 1px 1px',
												background: GUI_THEME.green,
												opacity: 0.35 + intensity * 0.65,
												transformOrigin: 'top',
												animation: reducedMotion
													? undefined
													: barGrowAnimation(
															index,
															firstCommitBar,
															lastCommitBar,
													  ),
												pointerEvents: 'none',
											}}
										/>
									);
								})}
							</div>
						)}

						{/* Playhead. Lives on the wrapper so it runs unbroken through
						    both charts and the gap between them. */}
						<div
							onMouseEnter={() => setNeedleHovered(true)}
							onMouseLeave={() => setNeedleHovered(false)}
							style={{
								position: 'absolute',
								left: `${thumbFraction * 100}%`,
								top: 0,
								bottom: 0,
								// A hairline, no glow: the needle marks an exact instant, and
								// a soft edge blooms over bars that can be ~2px wide.
								width: 1,
								background: NEEDLE_COLOR,
								zIndex: 3,
								transform: 'translateX(-0.5px)',
								pointerEvents: 'auto',
								cursor: 'pointer',
							}}
						/>
						<div
							onMouseEnter={() => setNeedleHovered(true)}
							onMouseLeave={() => setNeedleHovered(false)}
							style={{
								position: 'absolute',
								left: `${thumbFraction * 100}%`,
								top: needleHovered ? -9 : -7,
								width: 0,
								height: 0,
								borderLeft: `${needleHovered ? 6 : 5}px solid transparent`,
								borderRight: `${needleHovered ? 6 : 5}px solid transparent`,
								borderTop: `${needleHovered ? 8 : 7}px solid ${NEEDLE_COLOR}`,
								zIndex: 3,
								transform: `translateX(${needleHovered ? -6 : -5}px)`,
								pointerEvents: 'auto',
								cursor: 'pointer',
							}}
						/>

						{/* Both hints belong on the wrapper so they hang below the whole
						    scrubber rather than on top of the commit chart. */}
						{boardHoverLabel &&
							renderHoverHint(
								{
									label: boardHoverLabel.time,
									rows: [
										`${boardHoverLabel.count} board event${
											boardHoverLabel.count === 1 ? '' : 's'
										}`,
									],
								},
								GUI_THEME.accent,
								hoverHintLeftPx,
								boardHoverLabel.count === 0,
							)}

						{commitHoverLabel &&
							renderHoverHint(
								{label: commitHoverLabel.time, rows: commitHoverLabel.rows},
								GUI_THEME.green,
								commitHintLeftPx,
							)}
					</div>
				)}
			</div>
		</Panel>
	);
};
