import {useEffect, useMemo, useRef, useState} from 'react';

export const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

// ---------------------------------------------------------------- dimensions

// "even" is the "Volume" histogram, "real" the "Events" scatter, "flow" the
// strata of swimlanes each ticket's line travels between.
export type LayoutMode = 'even' | 'real' | 'flow';

export const isLayoutMode = (value: string | null): value is LayoutMode =>
	value === 'even' || value === 'real' || value === 'flow';

export const TRACK_HEIGHT = 24;

// "Volume" and "Events" share one total height, so switching never reflows the board.
const EVENTS_MODE_TOTAL_HEIGHT = 8 + TRACK_HEIGHT * 2;
export const EVENTS_SCATTER_HEIGHT = TRACK_HEIGHT + 16;
export const EVENTS_MODE_VERTICAL_PADDING =
	(EVENTS_MODE_TOTAL_HEIGHT - EVENTS_SCATTER_HEIGHT) / 2;

// "Flow" grows with the board: a band per lane, a slot per concurrent line,
// up to a cap past which the slots close up.
export const FLOW_SLOT_PX = 2;
const FLOW_STRAND_MIN = 14;
const FLOW_STRAND_MAX = 32;
// Room a band keeps above and below its outermost line.
const FLOW_BAND_MARGIN = 3;

// Clears the grain labels along the top edge.
const FLOW_TOP_INSET = 10;

export type FlowGeometry = {
	// Each strand's top edge and height, in px from the chart's top.
	tops: number[];
	heights: number[];
	height: number;
};

const strandHeight = (slots: number): number =>
	clamp(
		2 * FLOW_BAND_MARGIN + Math.max(1, slots) * FLOW_SLOT_PX,
		FLOW_STRAND_MIN,
		FLOW_STRAND_MAX,
	);

export const flowGeometry = (
	strands: readonly {slots: number}[],
): FlowGeometry => {
	const heights = strands.map(strand => strandHeight(strand.slots));
	const tops: number[] = [];
	let top = FLOW_TOP_INSET;

	for (const height of heights) {
		tops.push(top);
		top += height;
	}

	// Never shorter than the other modes: a board of few lanes keeps its
	// strands spread over the room the histogram had.
	const height = Math.max(EVENTS_MODE_TOTAL_HEIGHT, top);
	const spare = height - top;

	if (spare > 0 && heights.length > 0) {
		const extra = spare / heights.length;
		let shifted = FLOW_TOP_INSET;

		for (let index = 0; index < heights.length; index++) {
			heights[index]! += extra;
			tops[index] = shifted;
			shifted += heights[index]!;
		}
	}

	return {tops, heights, height};
};

export const flowStrandCentre = (
	geometry: FlowGeometry,
	strand: number,
): number => geometry.tops[strand]! + geometry.heights[strand]! / 2;

// A line's y: its strand's centre, offset by its slot with the strand's slots
// fanned symmetrically about that centre, closed up where the band is full.
export const flowLineY = (
	geometry: FlowGeometry,
	strand: number,
	slot: number,
	slots: number,
): number => {
	const band = geometry.heights[strand]! - 2 * FLOW_BAND_MARGIN;
	const spacing = Math.min(FLOW_SLOT_PX, band / Math.max(1, slots));

	return (
		flowStrandCentre(geometry, strand) + (slot - (slots - 1) / 2) * spacing
	);
};

// The gap above the charts, claimed for the pointer so aiming at a tall bar's top still hits.
export const TRACK_HIT_PADDING = 12;

export const HOVER_HINT_WIDTH = 220;

// Must stay fainter than the bucket highlight drawn over it.
export const SEGMENT_HIGHLIGHT_COLOR = 'rgba(122, 157, 214, 0.14)';
// The always-drawn grain: a faint hairline per segment boundary, and its label.
export const SEGMENT_BOUNDARY_COLOR = 'rgba(122, 157, 214, 0.06)';
export const SEGMENT_LABEL_COLOR = 'rgba(122, 157, 214, 0.32)';
export const BUCKET_HIGHLIGHT_COLOR = 'rgba(255, 255, 255, 0.06)';
export const NEEDLE_COLOR = 'rgba(255, 255, 255, 0.62)';

// The needle while the board stands in the past: full accent, so the eye finds it.
export const NEEDLE_PARKED_COLOR = 'rgba(118, 212, 255, 0.95)';

// Parked only: live, a glow would bloom over two-pixel bars.
export const NEEDLE_PARKED_GLOW = '0 0 6px rgba(118, 212, 255, 0.55)';

/** Hatches the unapplied stretch after the needle; dimming barely shows on the dark ground. */
export const UNAPPLIED_VEIL_IMAGE = `repeating-linear-gradient(
	135deg,
	rgba(118, 212, 255, 0.11) 0px,
	rgba(118, 212, 255, 0.11) 1px,
	transparent 1px,
	transparent 7px
)`;

// A wash under the hatch, so the stretch is a shade cooler than the live one
// even where a stripe does not fall.
export const UNAPPLIED_VEIL_COLOR = 'rgba(12, 18, 30, 0.45)';

// The needle's own edge against it: where the applied stretch ends.
export const UNAPPLIED_EDGE_COLOR = 'rgba(118, 212, 255, 0.25)';

// The scope checkbox's accent, dimmed.
export const SCOPED_OUTLINE_COLOR = 'rgba(118, 212, 255, 0.45)';

// Wider at the sides, to clear the needle's grip at the live end.
export const SCOPED_OUTLINE_INSET_X = 12;
export const SCOPED_OUTLINE_INSET_Y = 7;

// Brighter than either highlight: this one is being drawn by hand and has to
// read against whatever it is dragged over.
export const RANGE_SELECTION_COLOR = 'rgba(122, 157, 214, 0.22)';
export const RANGE_SELECTION_EDGE = 'rgba(160, 195, 250, 0.75)';

// The needle is drawn as a hairline, which is a 1px drag target. This is how
// wide the invisible grip over it is.
export const NEEDLE_GRIP_WIDTH = 11;

// Under this a press is a click, which scrubs, rather than a range to zoom to.
export const MIN_RANGE_DRAG_PX = 6;

// A range drag can end a pixel from where it started even past that threshold,
// and a window of milliseconds has no axis worth drawing.
export const MIN_ZOOM_SPAN_MS = 60 * 1000;

// Past this count a bar is ~2px, too thin to give up a pixel to the gap.
const MIN_BUCKET_COUNT_FOR_GAP = 300;

export const barWidthCss = (bucketCount: number): string =>
	bucketCount < MIN_BUCKET_COUNT_FOR_GAP
		? `calc(${100 / bucketCount}% - 1px)`
		: `${100 / bucketCount}%`;

// -------------------------------------------------------------------- buckets

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

// Forward keyframes filled `both`: full scale through the delay, zero after, so no
// dot pops back before unmount. Under `reverse`, Chrome blinks every dot out at once.
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

// After this, a newly mounted bar is not part of the entrance.
export const BAR_ENTRANCE_TOTAL_MS = BAR_GROW_MS + BAR_GROW_SWEEP_MS;

// On the series wrapper only: bars and dots remount on a scope change and would flash.
export const FADE_IN_ANIMATION = 'epiqScrubberFadeIn 320ms ease-out';

// Pager arrows show on hover or keyboard focus; `:focus-visible`, since a click leaves focus too.
export const PAGE_ARROW_CLASS = 'epiq-scrubber-page';
export const PAGED_TRACK_CLASS = 'epiq-scrubber-paged';

// Stylesheets, the exception to inline styles: :hover, :focus-visible and
// @keyframes have no React style-object form.
export const SCRUBBER_PAGER_STYLES = `
	.${PAGE_ARROW_CLASS} {
		opacity: 0;
		transition: opacity 120ms ease;
	}
	.${PAGED_TRACK_CLASS}:hover .${PAGE_ARROW_CLASS},
	.${PAGE_ARROW_CLASS}:has(:focus-visible) {
		opacity: 1;
	}
	@media (prefers-reduced-motion: reduce) {
		.${PAGE_ARROW_CLASS} { transition: none; }
	}
`;

export const SCRUBBER_KEYFRAMES = `
	/* The live mark, while the board is following: a ring leaving the centre
	   outwards and fading as it goes, replaced by the next one behind it. A
	   broadcast rather than a blink — it reads as something still arriving,
	   which is what following is, where a flash would read as an alert.

	   Two rings half a cycle apart, so there is always one on its way out and
	   the mark never empties. The standalone 'scale' property rather than
	   'transform', which the dots below need too, and 'transform-box: fill-box'
	   so an SVG circle scales about itself rather than the viewport's origin.

	   A reader who has asked for less motion gets one ring, at rest. */
	@keyframes epiqLiveRipple {
		from { scale: 0.3; opacity: 0.9; }
		to { scale: 1.3; opacity: 0; }
	}

	.epiq-live-ripple {
		transform-box: fill-box;
		transform-origin: center;
		animation: epiqLiveRipple 2s ease-out infinite;
	}

	.epiq-live-ripple--trailing {
		animation-delay: 1s;
	}

	@media (prefers-reduced-motion: reduce) {
		.epiq-live-ripple {
			animation: none;
			opacity: 0.55;
			scale: 1;
		}
		.epiq-live-ripple--trailing { display: none; }
	}

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

// Gated in JS, since what it guards is inline styles. Below this the controls
// row runs out of room for the scope buttons.
const NARROW_BAR_QUERY = '(max-width: 1180px)';

const useMediaQuery = (mediaQuery: string): boolean => {
	const [matches, setMatches] = useState(
		() => window.matchMedia(mediaQuery).matches,
	);

	useEffect(() => {
		const query = window.matchMedia(mediaQuery);
		const onChange = () => setMatches(query.matches);

		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	}, [mediaQuery]);

	return matches;
};

export const useNarrowBar = (): boolean => useMediaQuery(NARROW_BAR_QUERY);

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

// Keeps a hidden series mounted while its dots retract; `durationMs` 0 skips that.
export const useExitTransition = (
	visible: boolean,
	durationMs: number,
): SeriesPresence => {
	const [mounted, setMounted] = useState(visible);
	const [leaving, setLeaving] = useState(false);
	// Runs only when the flag flips, so a series hidden on first paint plays no exit.
	const wasVisible = useRef(visible);
	// A ref, so a duration change can't re-run the effect and strand the series mounted.
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

// One stacked bar's height and colour split. The floor keeps a minority share
// at least a pixel, rather than rounding it away.
export const stackedBarShape = (
	top: number,
	bottom: number,
	trackHeight: number,
): {height: number; share: number} => {
	const size = top + bottom;
	const height = Math.max(3, Math.min(1, size) * trackHeight);
	const floor = Math.min(1 / height, 0.5);

	const share =
		size === 0 || bottom === 0
			? 1
			: top === 0
			? 0
			: Math.min(Math.max(top / size, floor), 1 - floor);

	return {height, share};
};
