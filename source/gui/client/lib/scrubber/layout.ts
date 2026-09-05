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
