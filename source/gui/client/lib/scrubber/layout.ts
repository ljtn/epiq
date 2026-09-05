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

// The blank strip between the controls row and the charts, which the track
// claims for the pointer without drawing in it: aiming at the top of a tall bar
// otherwise lands just over it, on nothing. It is exactly the gap, so the strip
// reaches the controls and no further.
//
// Wide enough to hold the scoped outline as well, which is drawn outside the
// charts and would otherwise run along the underside of the controls.
export const TRACK_HIT_PADDING = 12;

export const HOVER_HINT_WIDTH = 220;

// Must stay fainter than the bucket highlight drawn over it.
export const SEGMENT_HIGHLIGHT_COLOR = 'rgba(122, 157, 214, 0.14)';
export const BUCKET_HIGHLIGHT_COLOR = 'rgba(255, 255, 255, 0.06)';
export const NEEDLE_COLOR = 'rgba(255, 255, 255, 0.62)';

// Ties the board's narrowing to the window doing it: the accent the checkbox
// wears while it is on, dimmed to sit around a chart rather than in a row.
export const SCOPED_OUTLINE_COLOR = 'rgba(118, 212, 255, 0.45)';

// How far that box sits outside the charts. Wider at the sides than above and
// below: the needle's grip is NEEDLE_GRIP_WIDTH across and centred on its
// stem, so at the live end it hangs half of that past the charts' own edge and
// would otherwise be drawn on the line. Above, TRACK_HIT_PADDING is all the
// room there is before the controls.
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
