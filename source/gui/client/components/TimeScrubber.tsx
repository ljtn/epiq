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
import {IconClock} from './IconClock';
import {Panel} from './Panel';

// Not reused from source/lib/event/date-utils.ts: that module is reachable
// (via event.model -> app-state.model -> action-map.model) from Node-only TUI
// code (readline, the command parser), which breaks the browser client's type
// program if pulled in. This copy is trivial enough to duplicate.
const formatDateTime = (date: Date): string => {
	const pad = (n: number) => String(n).padStart(2, '0');

	return (
		`${date.getFullYear()}-` +
		`${pad(date.getMonth() + 1)}-` +
		`${pad(date.getDate())} ` +
		`${pad(date.getHours())}:` +
		`${pad(date.getMinutes())}`
	);
};

// A bucket represents a time interval, not a single instant — show it as a
// range. Collapses the end side to just a time when it falls on the same day
// as the start, since repeating the date is noise at typical bucket sizes.
const formatInterval = (start: number, end: number): string => {
	const startDate = new Date(start);
	const endDate = new Date(end);
	const pad = (n: number) => String(n).padStart(2, '0');

	const sameDay =
		startDate.getFullYear() === endDate.getFullYear() &&
		startDate.getMonth() === endDate.getMonth() &&
		startDate.getDate() === endDate.getDate();

	const endLabel = sameDay
		? `${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`
		: formatDateTime(endDate);

	return `${formatDateTime(startDate)} – ${endLabel}`;
};

type TimeScrubberProps = {
	timeline: GuiEventTimeline | null;
	commits: GuiCommitEntry[];
	timeTravel: GuiTimeTravelStatus;
	onScrub: (targetTime: number) => void;
	onReturnToLive: () => void;
	// Undefined start/end asks for the default "all time" window.
	onRequestTimeline: (start?: number, end?: number) => void;
	onRequestCommits: (start?: number, end?: number) => void;
	onInspectCommit: (sha: string) => void;
};

// "even" divides the full time range into equal-width, equal-duration
// buckets (how many depends on the span — see bucketCountForSpan) and lays
// them out as a contiguous filmstrip — quiet
// buckets render with zero height rather than being hidden, so gaps in
// activity show up honestly as void instead of being absorbed into
// neighboring buckets. "real" instead positions each individual event (not
// a bucket) proportionally to its own elapsed time — a scatter, not a
// histogram.
type LayoutMode = 'even' | 'real';

// "all" is the full project history. The others scope + zoom the timeline to
// a single calendar period, which — since the server buckets a fixed count
// across whatever window it's given — is what makes narrower scopes more
// precise for free.
type Scope = 'all' | 'week' | 'month' | 'year';

type PeriodRange = {start: number; end: number};

// How often a drag dispatches `onScrub` while the pointer is moving. The
// visual thumb still tracks every pointer move locally.
const SCRUB_THROTTLE_MS = 120;

// Both tracks stay this height in both modes — "Events" mode's y-axis
// (time-of-day, see hourFractionForTime below) fits into the same compact
// strip "Volume" mode uses, via smaller data points, rather than growing the
// track itself. An animated height difference between modes was tried and
// reverted: even top-anchored, a taller track pushes the board content below
// it down as it grows, which read as the board "following" the animation.
const TRACK_HEIGHT = 24;

// "Volume" mode's total footprint is two boxes: the issue track plus, below
// it, the separate mirrored commit box (TRACK_HEIGHT again) with an 8px gap
// between them (see the outer column's own `gap`) — 56px combined. "Events"
// mode has only the one (shared/overlaid) box, so it needs padding to match
// that total, or swapping modes would shrink/grow the panel and reflow the
// board below it (the same problem the height-animation approach had, just
// in reverse). The scatter area itself (where points actually plot) is
// taller than TRACK_HEIGHT — more room for the hour-of-day spread to read
// clearly — with the leftover padding split evenly top and bottom so the
// taller area sits centered in that same 56px total rather than flush at
// the top.
const EVENTS_MODE_TOTAL_HEIGHT = 8 + TRACK_HEIGHT * 2;
const EVENTS_SCATTER_HEIGHT = TRACK_HEIGHT + 16;
const EVENTS_MODE_VERTICAL_PADDING =
	(EVENTS_MODE_TOTAL_HEIGHT - EVENTS_SCATTER_HEIGHT) / 2;

// Applied to each data series' wrapper (see the <style> keyframes below) so
// switching its checkbox on plays a smooth fade rather than a hard pop —
// only on appear: since these wrappers unmount entirely when off, there's no
// DOM node left to animate a fade-out against, which is fine, an abrupt
// disappearance reads fine; it's the sudden appearance that looked jarring.
const FADE_IN_ANIMATION = 'epiqScrubberFadeIn 280ms ease';

// Width of the floating hover-hint tooltip, used both to render it and to
// clamp its position so it never overflows past the track's edges. Wraps to
// multiple lines rather than truncating, so wide enough to keep that from
// looking cramped, but not so wide it swamps the narrow track it floats over.
const HOVER_HINT_WIDTH = 220;

const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

const DAY_MS = 24 * 60 * 60 * 1000;

// Bounds on "Volume" mode's bucket count. The floor keeps a very short span
// from collapsing into a handful of absurdly chunky blocks; the ceiling keeps
// a very long one from producing sub-pixel bars that can't be seen or hovered
// at all (and thousands of DOM nodes to draw them with).
const MIN_TIME_BUCKETS = 60;
const MAX_TIME_BUCKETS = 900;

// Bucket count scales with how much time is on screen, rather than being
// fixed: a week of history gets fairly fine bars, "all time" gets a dense,
// near-pixel-wide density strip. Sub-linear is the point — a span 50x longer
// gets only ~4x the buckets, so each bucket still covers *more* real time as
// you zoom out, but the bars visibly thin out instead of staying the same
// width and silently swallowing ever-larger intervals.
//
// The exponent and coefficient are just the curve through two chosen anchors:
// ~220 buckets at a 7-day span, ~800 at a 365-day one. Deliberately biased
// toward resolution over chunkiness even at narrow scopes — a week rendered
// as ~100 fat blocks averages away exactly the working-rhythm detail (which
// hours had bursts, which were idle) that makes looking at a single week
// worthwhile in the first place. Hover is resolved arithmetically rather than
// by hit-testing elements, so finer bars cost nothing in pointer accuracy.
const bucketCountForSpan = (spanMs: number): number => {
	const days = Math.max(1, spanMs / DAY_MS);

	return Math.round(
		clamp(116.5 * Math.pow(days, 0.3265), MIN_TIME_BUCKETS, MAX_TIME_BUCKETS),
	);
};

// Below this width a bar is too thin to spare a pixel for the separating gap
// — at ~2px, subtracting one would halve it. Wider bars keep the gap, since
// that's what makes them read as discrete buckets rather than one continuous
// area; past this density the bars merge into a profile anyway, which is the
// intended look at wide spans.
const MIN_BUCKET_COUNT_FOR_GAP = 300;

// A wash rather than a line: the segment a pointer is inside gets tinted, so
// the calendar structure is revealed on demand instead of being permanently
// drawn over the track. Keeps the black canvas clean when nothing is hovered,
// which is most of the time. Fainter than the bucket highlight over it, so
// the two read as "this day" (broad) versus "this bucket" (precise) rather
// than competing.
//
// Blue-grey rather than neutral white — a plain white wash reads warm against
// this palette's cool accents and greys, and looked like a smudge rather than
// part of the design.
const SEGMENT_HIGHLIGHT_COLOR = 'rgba(122, 158, 214, 0.07)';

// Below this the label can't fit inside its own block without being clipped
// or crowding the neighbouring ones, so it's dropped and the tooltip (which
// carries the same label) is left to answer the question.
const MIN_SEGMENT_WIDTH_FOR_LABEL = 78;

// Muted rather than pure white: at 1px the needle reads as a crisp hairline
// either way, and full white made it the brightest thing on the panel —
// louder than the data it's there to point at.
const NEEDLE_COLOR = 'rgba(255, 255, 255, 0.62)';

// Calendar units the timeline can be segmented by, finest first. Which one is
// used depends on the span (see chooseSegmentUnit) — days for a week's view,
// months for a year's, and so on.
const SEGMENT_UNIT_ORDER = ['day', 'week', 'month', 'year'] as const;
type SegmentUnit = (typeof SEGMENT_UNIT_ORDER)[number];

const APPROX_UNIT_MS: Record<SegmentUnit, number> = {
	day: 24 * 60 * 60 * 1000,
	week: 7 * 24 * 60 * 60 * 1000,
	month: 30.44 * 24 * 60 * 60 * 1000,
	year: 365.25 * 24 * 60 * 60 * 1000,
};

// Past roughly this many segments across the track, each one is too narrow to
// pick out or label usefully, so the next coarser unit takes over.
//
// Set high enough that a month's view lands comfortably on days (~30) rather
// than teetering on the threshold: right at the boundary, two runs with
// slightly different data spans would pick different units and the highlight
// would appear to change meaning on its own. The stable result is days for a
// week or a month, months (or weeks) for longer spans.
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

// The calendar period containing `time`, snapped to real calendar edges —
// local midnight, Monday, the 1st, Jan 1 — rather than to multiples of a
// fixed duration measured from the range start. That distinction is the whole
// value: a block covering "24h from whenever the first commit happened" marks
// nothing a person recognizes, whereas "this is Tuesday" is instantly
// readable. Stepping via the Date setters (rather than adding milliseconds)
// also keeps midnight *at* midnight across DST changes, where a day is 23 or
// 25 hours long.
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

	// The last moment inside the period, not the first moment after it —
	// labelling a week as "10 – 17 Aug" would wrongly imply 8 days.
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

// Outline rather than filled — a solid accent block per active toggle reads
// as heavy with this many buttons in one row; border + text color is enough
// to show selection (matches the "Return to live" button's own style).
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

const VALID_SCOPES: readonly Scope[] = ['all', 'week', 'month', 'year'];

const readStoredScope = (): Scope => {
	const stored = localStorage.getItem(SCOPE_STORAGE_KEY);
	return (VALID_SCOPES as readonly string[]).includes(stored ?? '')
		? (stored as Scope)
		: 'all';
};

// Rolling window `offset` periods back from now — plain duration arithmetic,
// not calendar-boundary snapping. offset 0 = the most recent N days ending
// now; offset 1 = the N days before that; etc.
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
	onRequestTimeline,
	onRequestCommits,
	onInspectCommit,
}: TimeScrubberProps) => {
	const trackRef = useRef<HTMLDivElement | null>(null);
	const lastDispatchRef = useRef(0);
	const [layoutMode, setLayoutMode] = useState<LayoutMode>('even');
	const [scope, setScope] = useState<Scope>(readStoredScope);
	const [offset, setOffset] = useState(0);
	const [dragFraction, setDragFraction] = useState<number | null>(null);
	// "Events" mode only, where individual points carry their own enter/leave
	// handlers. `time` always renders as the tooltip's first row, for both
	// this (board) and the commit tooltip below — a consistent anchor
	// regardless of what other stats follow.
	const [hoverLabel, setHoverLabel] = useState<{
		time: string;
		count: number;
		t: number;
	} | null>(null);
	const [hoveredBucketFraction, setHoveredBucketFraction] = useState<
		number | null
	>(null);
	const [needleHovered, setNeedleHovered] = useState(false);
	const [hoveredCommit, setHoveredCommit] = useState<GuiCommitEntry | null>(
		null,
	);
	const [hoveredCommitFraction, setHoveredCommitFraction] = useState<
		number | null
	>(null);
	// "Volume" mode's hover, tracked as a bare bucket index resolved from the
	// pointer's x position by a single handler on each track — rather than by
	// giving every bucket its own hit-target element. At wide spans buckets
	// are only ~2px across, which made per-element hit targets both fiddly to
	// aim at and needlessly numerous (hundreds of DOM nodes whose only job was
	// to notice a mouse). Deriving the index arithmetically is pixel-accurate
	// at any density and costs nothing.
	const [hoveredBucketIndex, setHoveredBucketIndex] = useState<number | null>(
		null,
	);
	const [hoveredCommitBucketIndex, setHoveredCommitBucketIndex] = useState<
		number | null
	>(null);
	const [collapsed, setCollapsed] = useState(
		() => localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true',
	);
	// Which data series to draw — a pure display filter, doesn't affect what's
	// fetched or the scrub/needle mechanics.
	const [showIssues, setShowIssues] = useState(true);
	const [showCommits, setShowCommits] = useState(true);

	const toggleCollapsed = () => {
		setCollapsed(next => {
			const nextCollapsed = !next;
			localStorage.setItem(COLLAPSED_STORAGE_KEY, String(nextCollapsed));
			return nextCollapsed;
		});
	};

	const periodRange = getPeriodRange(scope, offset);

	// Deliberately keyed on scope/offset only — onRequestTimeline/onRequestCommits
	// are stable useCallbacks from the parent, and periodRange is derived from
	// scope/offset each render, so including either would just be redundant.
	useEffect(() => {
		onRequestTimeline(periodRange?.start, periodRange?.end);
		onRequestCommits(periodRange?.start, periodRange?.end);
	}, [scope, offset]);

	const changeScope = (nextScope: Scope) => {
		setScope(nextScope);
		setOffset(0);
		localStorage.setItem(SCOPE_STORAGE_KEY, nextScope);
	};

	const commitTimes = commits.map(c => c.time);

	// Widened to cover commits too (they often predate the earliest issue
	// event, especially in "All time" scope) — every layer (histogram
	// buckets, scatter points, the needle) shares this axis, so a given x
	// always means the same moment no matter which series drew it.
	const earliest = Math.min(
		timeline?.buckets[0]?.t ?? timeline?.earliest ?? Date.now(),
		...(commitTimes.length ? commitTimes : [Date.now()]),
	);
	const latest = Math.max(
		timeline?.latest ?? Date.now(),
		...(commitTimes.length ? commitTimes : [Date.now()]),
	);
	const span = Math.max(1, latest - earliest);

	// How many buckets to divide this particular span into — scaled to the
	// span rather than fixed, so bars thin out as you zoom out (see
	// bucketCountForSpan). Uniform within a given view either way, which is
	// what keeps every bar the same width and directly comparable.
	const timeBucketCount = bucketCountForSpan(span);

	// Duration each histogram bucket covers. Uniform by construction — this
	// is the whole point of the fixed-bucket model: bucket N always spans
	// [earliest + N*bucketMs, earliest + (N+1)*bucketMs), whether or not
	// anything happened in it.
	const timeBucketMs = span / timeBucketCount;

	const timeBucketIndexForTime = (time: number) =>
		clamp(Math.floor((time - earliest) / timeBucketMs), 0, timeBucketCount - 1);

	// "Volume" mode's histogram: a dense, fully-populated array of equal-
	// duration buckets covering the whole range, including empty ones.
	//
	// This deliberately re-aggregates the server's own (much finer, sparse)
	// buckets rather than using them directly as display slots. The server
	// only emits a bucket where an event actually occurred, so using them
	// as-is made every rendered bar a different real duration — visually
	// uniform but temporally meaningless, and quiet stretches vanished
	// entirely instead of showing as the gaps they are. Re-bucketing here
	// costs nothing (the sparse input is small) and makes bar position and
	// width both mean exactly one thing: elapsed time.
	const timeBuckets: GuiEventTimelineBucket[] = Array.from(
		{length: timeBucketCount},
		(_, index) => ({t: earliest + index * timeBucketMs, count: 0}),
	);
	for (const sparseBucket of timeline?.buckets ?? []) {
		const index = timeBucketIndexForTime(sparseBucket.t);
		timeBuckets[index]!.count += sparseBucket.count;
	}

	// Position of a moment along the track, proportional to elapsed time.
	// Shared by *both* layout modes now that "Volume" mode's buckets are
	// themselves evenly spaced in time — previously each mode needed its own
	// coordinate system, since the filmstrip's slot order didn't correspond
	// to elapsed time at all.
	const fractionForTime = (time: number) =>
		clamp((time - earliest) / span, 0, 1);

	// The calendar unit the track is segmented by, scaled to the span: days at
	// a week's or month's view, weeks or months at longer ones. Nothing is
	// drawn for it until something is hovered — the structure is revealed on
	// demand rather than permanently overlaid, which keeps the track's black
	// canvas intact while still letting you locate any point in the calendar.
	// Only meaningful because x is now genuinely proportional to elapsed time;
	// under the old filmstrip layout there was no consistent position for
	// "midnight" to occupy.
	const segmentUnit = chooseSegmentUnit(span);

	// "Events" mode's y-axis: where in the 24-hour cycle a moment falls, 0 (0:00,
	// top) to just under 1 (23:59, bottom) — so noon sits at the vertical
	// center. Applied identically to both series (same TRACK_HEIGHT scale), so
	// a board event and a commit at the same hour of day land at the same
	// height — letting you visually compare when in the day each kind of
	// activity tends to happen.
	const hourFractionForTime = (time: number) => {
		const date = new Date(time);
		return (date.getHours() * 60 + date.getMinutes()) / (24 * 60);
	};

	const confirmedFraction =
		timeTravel.mode === 'scrub' && timeTravel.asOfTime !== null
			? fractionForTime(timeTravel.asOfTime)
			: 1;

	const thumbFraction = dragFraction ?? confirmedFraction;

	// Maps a pointer's fraction along the track to a target time. One formula
	// for both modes — with buckets now laid out proportionally to elapsed
	// time, "snap to the bucket under the cursor" and "interpolate across the
	// span" agree to within a single bucket's width, so the old per-mode
	// split bought nothing but a second code path to keep in sync.
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

	// Which "Volume" bucket sits under the pointer. Measures against the
	// element actually being hovered rather than trackRef, so the same handler
	// serves both the issue track and the mirrored commit box below it.
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

	const endDrag = () => {
		if (dragFraction === null) return;

		dispatchScrub(dragFraction, true);
		setDragFraction(null);
	};

	// Two separate maxima because the two modes plot genuinely different
	// datasets: "Volume" plots the coarse re-aggregated histogram buckets,
	// "Events" plots the server's own fine-grained sparse buckets (each ~one
	// real moment). Normalizing both against a single max would flatten one
	// of them — a coarse bucket's count is a sum of many fine ones.
	const maxIssueBucketCount = Math.max(1, ...timeBuckets.map(b => b.count));
	const maxIssueEventCount = Math.max(
		1,
		...(timeline?.buckets ?? []).map(b => b.count),
	);

	// "Volume" mode's commit histogram, aggregated into the exact same
	// fixed-duration buckets as the issue histogram above, so the mirrored
	// "iceberg" halves line up moment-for-moment. Bar height is driven by
	// commit count, the same metric (and same linear formula) the issue bars
	// use, keeping both halves on equal footing. `linesChanged` is still
	// summed per bucket and surfaced in the hover tooltip, just not used for
	// sizing.
	//
	// Each commit lands in the bucket that literally contains its timestamp
	// — no nearest-neighbor snapping. That distinction fixed a real bug: the
	// old sparse layout snapped every commit to the closest *issue-event*
	// bucket with no distance cap, so a whole quiet day of commits piled onto
	// one narrow bucket and read as an impossible burst ("16 commits in 2
	// minutes"). With containment-based bucketing that can't happen — a
	// bucket's contents are always exactly what occurred inside its own
	// window.
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

	// The board tooltip's contents, from whichever source is active: a
	// pointer-resolved bucket index in "Volume" mode, or an individual
	// point's own hover state in "Events" mode.
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

	// One segment for the whole component, resolved from whichever hover is
	// active — board track or commit track, either layout mode. Deliberately
	// shared: hovering a commit lights up the same day in the issue track
	// above, which is what makes the two halves legible as one time grid
	// rather than two charts that happen to sit near each other.
	const hoveredSegmentTime =
		(layoutMode === 'even'
			? hoveredBucket?.t ??
			  (hoveredCommitBucketIndex !== null
					? timeBuckets[hoveredCommitBucketIndex]?.t
					: undefined)
			: hoverLabel?.t ?? hoveredCommit?.time) ?? null;
	const hoveredSegment =
		hoveredSegmentTime !== null
			? segmentAt(hoveredSegmentTime, segmentUnit)
			: null;

	// One renderer for every hover-hint, rather than three near-identical
	// blocks. All of them hang *below* the charts: floating above meant
	// covering the scope/mode controls and the hovered block's own label,
	// which is exactly the context you're reading while pointing at something.
	const renderHoverHint = (
		content: {label: string; rows: string[]},
		stripeColor: string,
		leftPx: number,
	) => (
		<div
			style={{
				position: 'absolute',
				top: '100%',
				marginTop: 6,
				left: leftPx,
				width: HOVER_HINT_WIDTH,
				// Border-box so `width` matches what the clamp math assumes —
				// otherwise the border/padding add on top of it and the box
				// overflows the track's edge by exactly that much.
				boxSizing: 'border-box',
				display: 'flex',
				flexDirection: 'column',
				gap: 2,
				textAlign: 'left',
				background: GUI_THEME.panel,
				border: `1px solid ${GUI_THEME.line}`,
				// Overrides just the left edge — a color-coded stripe so which
				// series' hint this is stays obvious even where board/commit points
				// are cluttered together.
				borderLeft: `3px solid ${stripeColor}`,
				borderRadius: 6,
				padding: '6px 10px',
				pointerEvents: 'none',
				// Above the board content it now overhangs.
				zIndex: 5,
			}}
		>
			{/* Calendar context above the precise interval — which day (or
			    week/month) this is, matching the highlighted block behind the
			    track. The exact timestamps below answer "when precisely"; this
			    answers "when, in terms a person navigates by". */}
			{hoveredSegment && (
				<div style={{fontSize: 10, color: GUI_THEME.dim}}>
					{hoveredSegment.label}
				</div>
			)}
			<div
				style={{
					fontSize: 11,
					fontWeight: 600,
					color: GUI_THEME.primary,
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
						color: GUI_THEME.secondary,
						whiteSpace: 'normal',
						wordBreak: 'break-word',
					}}
				>
					{row}
				</div>
			))}
		</div>
	);

	// Center the hover-hint tooltip on the hovered bucket, clamped so it never
	// overflows past the track's own left/right edges.
	const trackWidthPx = trackRef.current?.clientWidth ?? 0;

	// Measured rather than assumed: a segment clipped by the range's own start
	// or end (the first and last are usually partial) can be far narrower than
	// a full period, and would otherwise get a label it has no room for.
	const hoveredSegmentWidthPx = hoveredSegment
		? (fractionForTime(hoveredSegment.end) -
				fractionForTime(hoveredSegment.start)) *
		  trackWidthPx
		: 0;
	const hoverHintLeftPx =
		boardHoverFraction !== null
			? clamp(
					boardHoverFraction * trackWidthPx - HOVER_HINT_WIDTH / 2,
					0,
					Math.max(0, trackWidthPx - HOVER_HINT_WIDTH),
			  )
			: 0;

	// Unifies the two commit-hover sources (a single dot in "Events" mode, an
	// aggregated bucket bar in "Volume" mode) into one time/rows shape so the
	// floating hint below only needs one code path — `time` is always the
	// first row, matching the board tooltip's own top row.
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
						// The bucket's own window is the honest answer: commits are
						// bucketed by containment, so everything counted here genuinely
						// happened inside this interval.
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
				// Panel clips its children by default (to keep its glow inside its
				// rounded corners). The hover tooltip deliberately floats *above*
				// the track, which puts it outside this panel's box entirely, so
				// clipping would lop off its top. Safe to disable here: this panel
				// is square (borderRadius 0, no top border), so there's no rounding
				// for the clip to protect.
				overflow: 'visible',
			}}
		>
			{/* A plain inline style tag rather than a CSS module/file, matching
			    this codebase's inline-style-only convention elsewhere — @keyframes
			    can't be expressed as a React style object, so this is the one
			    exception. Used below to fade each data series in when its
			    checkbox is switched on, so toggling reads as a smooth reveal
			    rather than a hard pop. */}
			<style>{`
				@keyframes epiqScrubberFadeIn {
					from { opacity: 0; }
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
				{/* Status + controls row — kept separate from the track row below so
				    nothing here (the read-only banner appearing/disappearing, hover
				    text changing) ever resizes or shifts the scrubber itself. */}
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						// Fixed height regardless of whether the banner is rendered, so
						// the track row below never shifts vertically either.
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
						{/* Always in the same spot regardless of collapsed state, so it
						    stays discoverable as the one persistent handle. */}
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

						{/* Kept visible even collapsed — the one thing worth surfacing
						    even with the scrubber tucked away is that you're looking
						    at read-only history, not the live board. */}
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
												// Fixed width (not min) so this label changing text
												// never shifts the buttons around it.
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

							{/* Which data series to draw — a pure display filter, doesn't
							    change what's fetched. */}
							<div style={{display: 'flex', gap: 10}}>
								<label
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: 4,
										fontSize: 10,
										color: GUI_THEME.dim,
										cursor: 'pointer',
									}}
								>
									<input
										type="checkbox"
										checked={showIssues}
										onChange={event => setShowIssues(event.target.checked)}
										style={{accentColor: GUI_THEME.accent, cursor: 'pointer'}}
									/>
									Epiq
								</label>
								<label
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: 4,
										fontSize: 10,
										color: GUI_THEME.dim,
										cursor: 'pointer',
									}}
								>
									<input
										type="checkbox"
										checked={showCommits}
										onChange={event => setShowCommits(event.target.checked)}
										style={{accentColor: GUI_THEME.green, cursor: 'pointer'}}
									/>
									Code
								</label>
							</div>

							<div
								style={{
									display: 'flex',
									justifyContent: 'flex-end',
									alignItems: 'center',
									// Fixed (not min) width so swapping between "Now" and "Return
									// to live" never resizes the controls row.
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
					// Wraps both stacked charts so the hovered-period highlight can be
					// a single tall block spanning them *and* the gap between them,
					// rather than two separate blocks that merely line up. Reads as one
					// timeline cut at that period, which is what the mirrored layout is
					// trying to say in the first place. Drawn as the first child so the
					// data (positioned siblings, painted in DOM order) sits on top.
					<div
						// Scrubbing is bound to the wrapper, not the individual charts, so
						// a drag works anywhere across the pair — including the lower
						// commit chart and the gap between them. They read as one chart,
						// so "which half am I over" shouldn't decide whether the click
						// selects a time.
						onPointerDown={onPointerDown}
						onPointerMove={onPointerMove}
						onPointerUp={endDrag}
						onPointerCancel={endDrag}
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
									// Names the block in place, so the highlight says what it
									// *is* and not merely where it ends. Top-aligned because
									// that's the emptiest part of the pair: issue bars grow up
									// from the axis and commit bars grow down from it, leaving
									// the outer edges clear except at peak intensity.
									display: 'flex',
									justifyContent: 'center',
									paddingTop: 3,
									// With both top and bottom pinned, content-box would add the
									// padding on top of the resolved height and push the block
									// past the wrapper it's meant to span.
									boxSizing: 'border-box',
									fontSize: 9,
									color: GUI_THEME.dim2,
									whiteSpace: 'nowrap',
									overflow: 'hidden',
								}}
							>
								{hoveredSegmentWidthPx >= MIN_SEGMENT_WIDTH_FOR_LABEL
									? hoveredSegment.label
									: null}
							</div>
						)}

						<div
							ref={trackRef}
							// "Volume" mode resolves the hovered bucket from the pointer's
							// x position here, once, instead of per bucket. "Events" mode
							// leaves this alone — there the individual points carry their
							// own handlers, since a scatter has no column to fall into.
							onMouseMove={
								layoutMode === 'even'
									? event => setHoveredBucketIndex(bucketIndexFromEvent(event))
									: undefined
							}
							onMouseLeave={
								layoutMode === 'even'
									? () => setHoveredBucketIndex(null)
									: undefined
							}
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
							{/* Track line — a floor for "Volume" mode's stacked-bar look; in
					    "Events" mode it falls at the vertical center by virtue of the
					    track's own flex-centering, which — since y spans 0:00 to
					    23:59 top-to-bottom — lands it exactly on noon. Same treatment
					    (accent color, low opacity) as the code track's own baseline
					    below, so the two read as one paired axis. */}
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

							{/* y-axis reference labels for "Events" mode's hour-of-day scale —
					    unobtrusive, just enough to anchor what the vertical spread
					    means. Matches the commit track's own labels below. */}
							{layoutMode === 'real' && (
								<>
									<span
										style={{
											position: 'absolute',
											left: 2,
											// Aligned with where the 0:00-mapped points themselves
											// start (see EVENTS_MODE_VERTICAL_PADDING) — absolute
											// positioning ignores padding, so this has to be added
											// back in explicitly rather than a plain `top: 2`.
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

							{/* Board activity. The two modes plot different things from
					    different sources, so they get genuinely separate branches
					    rather than one parameterized loop: "Volume" draws the dense
					    fixed-duration histogram (every bucket, including empty ones),
					    "Events" draws the server's fine-grained sparse buckets as
					    individual 2D points. */}
							{showIssues && layoutMode === 'even' && (
								<>
									{/* Hover column, drawn once for whichever bucket the
									    pointer resolved to (see the track's onMouseMove).
									    Spans the full track height rather than tracking the
									    bar's own, so the highlight reads as "this slice of
									    time" — including for empty buckets, where there's no
									    bar to highlight at all but "0 changes" is still worth
									    surfacing. */}
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
												// Floored so the highlight stays visible at wide spans,
												// where a bucket can be thinner than a pixel.
												minWidth: 2,
												background: 'rgba(255, 255, 255, 0.06)',
												pointerEvents: 'none',
											}}
										/>
									)}

									{timeBuckets.map((bucket, index) => {
										// A genuinely quiet bucket renders nothing — deliberately
										// void rather than a token sliver, since "nothing happened
										// here" is real information the old gapless filmstrip used
										// to hide. It stays hoverable regardless, because hover is
										// resolved arithmetically rather than by hit-testing an
										// element that would have to exist for the purpose.
										if (bucket.count === 0) return null;

										const intensity = bucket.count / maxIssueBucketCount;
										const widthPercent = 100 / timeBucketCount;
										const barWidth =
											timeBucketCount < MIN_BUCKET_COUNT_FOR_GAP
												? `calc(${widthPercent}% - 1px)`
												: `${widthPercent}%`;

										return (
											<div
												key={bucket.t}
												style={{
													position: 'absolute',
													left: `${index * widthPercent}%`,
													// Bottom-anchored so height reads as a stacked-bar
													// chart — how much happened at that point in time —
													// rather than a centered blip.
													bottom: 0,
													width: barWidth,
													height: 3 + intensity * 21,
													borderRadius: '1px 1px 0 0',
													background: GUI_THEME.accent,
													opacity: 0.35 + intensity * 0.65,
													// Purely decorative now: the track's own handler owns
													// hover, so bars never need to catch the pointer.
													pointerEvents: 'none',
													animation: FADE_IN_ANIMATION,
												}}
											/>
										);
									})}
								</>
							)}

							{showIssues &&
								layoutMode === 'real' &&
								(timeline?.buckets ?? []).map(bucket => {
									// "Events" mode plots each event cluster as a point in 2D: x is
									// when in the project's history it happened (elapsed time), y is
									// what time of day it happened — the same hour-of-day scale the
									// commit dots use, so the two are directly comparable.
									const intensity = bucket.count / maxIssueEventCount;
									const fraction = fractionForTime(bucket.t);
									const hourFraction = hourFractionForTime(bucket.t);
									const size = 3 + intensity * 6;
									const label = formatDateTime(new Date(bucket.t));

									return (
										<div
											key={bucket.t}
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
												// Capped below 1 (unlike the Volume-mode bar's opacity)
												// so overlapping points — a board event and a commit at
												// the same moment, or several close together — stay
												// visible as a blend rather than one fully hiding another.
												opacity: 0.3 + intensity * 0.5,
												// Above the commit dots (z-index 1, see below) — the
												// board is the primary thing being visualized here.
												zIndex: 2,
												transform: `translate(${-size / 2}px, -50%)`,
												pointerEvents: 'auto',
												animation: FADE_IN_ANIMATION,
											}}
										/>
									);
								})}

							{/* Code commits, overlaid directly on the same axis as the issue
							    points above (not a separate box) — x is exact elapsed time, y
							    is time of day, the same hour-of-day scale the issue points use,
							    so a board event and a commit at the same hour of day land at
							    literally the same height. Only in "Events" mode: "Volume" mode
							    keeps its own separate mirrored box below (see the commits.length
							    check further down), since an aggregated bar chart has no
							    per-point position to overlay. stopPropagation on
							    pointerdown/click so clicking a dot to inspect its diff doesn't
							    also start a scrub-drag on the shared track underneath it. */}
							{showCommits && layoutMode === 'real' && commits.length > 0 && (
								<>
									{commits.map(commit => {
										const fraction = fractionForTime(commit.time);
										const hourFraction = hourFractionForTime(commit.time);
										// Uniform size — an individual commit doesn't have a "count"
										// of its own to vary by, unlike the aggregated bucket bars in
										// Volume mode. Small, to fit the compact shared track height.
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
													// (a commit and a board event at the same moment, or
													// several commits close together) stay visible as a
													// blend rather than one fully hiding another. Hover
													// still goes fully opaque — that's a deliberate focus
													// state, not something that needs to blend.
													opacity: hoveredCommit?.sha === commit.sha ? 1 : 0.55,
													// Below the board's own points (z-index 2 above) — the
													// board is the primary thing being visualized here.
													zIndex: 1,
													transform: `translate(${-size / 2}px, -50%)`,
													pointerEvents: 'auto',
													animation: FADE_IN_ANIMATION,
													cursor: 'pointer',
												}}
											/>
										);
									})}
								</>
							)}
						</div>

						{/* Code commits — a second, mirrored box, "Volume" mode only. In
						    "Events" mode commits render overlaid directly on the track above
						    instead (see the commit-dot block there) — a histogram has no
						    single point to overlay, so the two modes need genuinely
						    different commit layouts. Commits fall into the same
						    fixed-duration time buckets as the issue histogram above and
						    render as one bar per bucket, top-anchored and growing downward
						    — the mirror image of the issue bars' bottom-anchored growth, so
						    the two tracks read as one shape (an "iceberg") expanding away
						    from the shared axis between them in both directions. Because
						    both halves now share one time grid, a given x is the same
						    interval in both — which is what makes the mirroring meaningful
						    rather than merely decorative. */}
						{showCommits && layoutMode === 'even' && commits.length > 0 && (
							<div
								// Same pointer-resolved hover as the issue track above,
								// measured against this box's own width (which matches it).
								onMouseMove={event =>
									setHoveredCommitBucketIndex(bucketIndexFromEvent(event))
								}
								onMouseLeave={() => setHoveredCommitBucketIndex(null)}
								style={{
									position: 'relative',
									width: '100%',
									// Matches the issue track's own height above, so the two
									// tracks carry equal visual weight — the "iceberg" shape only
									// reads if both halves are comparably sized.
									height: TRACK_HEIGHT,
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
											key={bucket.t}
											style={{
												position: 'absolute',
												left: `${index * widthPercent}%`,
												// Top-anchored so it grows downward, mirroring the
												// issue bar's bottom-anchored growth above, using the
												// same count-based intensity formula.
												top: 0,
												width: barWidth,
												height: 3 + intensity * 21,
												borderRadius: '0 0 1px 1px',
												background: GUI_THEME.green,
												opacity: 0.35 + intensity * 0.65,
												pointerEvents: 'none',
												animation: FADE_IN_ANIMATION,
											}}
										/>
									);
								})}
							</div>
						)}

						{/* Draggable thumb / playhead, in a color distinct from the
					    accent-colored bars so it stays visible against them, with a
					    downward-pointing triangle handle that highlights on hover for
					    grab affordance. z-index above both data layers (2 and 1, see
					    above) so it's never obscured.

					    Lives on the wrapper rather than inside the upper chart, so it
					    runs unbroken down through both charts and the gap between them
					    — a playhead that stopped at the first chart's floor would
					    undercut the whole point of mirroring them about a shared
					    axis. */}
						<div
							onMouseEnter={() => setNeedleHovered(true)}
							onMouseLeave={() => setNeedleHovered(false)}
							style={{
								position: 'absolute',
								left: `${thumbFraction * 100}%`,
								top: 0,
								bottom: 0,
								// A hairline in plain white, no glow. The needle marks an
								// exact instant, and a soft-edged glowing bar contradicts
								// that — it also bloomed over the data it sits on, which
								// matters more now that the bars can be ~2px wide.
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
								// Matches the needle's own white; the handle is the part
								// you grab, so it keeps its size change on hover as the
								// affordance instead of a glow.
								borderTop: `${needleHovered ? 8 : 7}px solid ${NEEDLE_COLOR}`,
								zIndex: 3,
								transform: `translateX(${needleHovered ? -6 : -5}px)`,
								pointerEvents: 'auto',
								cursor: 'pointer',
							}}
						/>

						{/* Both hints live here, in the wrapper spanning both charts, so
						    they hang below the whole scrubber rather than between the two
						    tracks (where the board hint used to land on top of the commit
						    chart). */}
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
