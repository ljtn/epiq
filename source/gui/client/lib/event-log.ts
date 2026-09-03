// The log panel's own logic: which lines it holds, and how the column moves as
// they arrive. Not theatre's, though a movie is one of the three things that
// can drive it — the panel is on the board whenever its box is ticked.
//
// One rule throughout: the last few events at or before the moment the board is
// standing at. What supplies that moment differs — the playhead while a movie
// runs, the checkout while the needle is parked, the present while live — but
// the slice does not.

// How many lines the panel holds. A cap on the document as much as on the
// reading: rows above this have scrolled up out of the fade, and keeping them
// mounted would grow the panel by a node per event for as long as it is open.
export const LOG_LINES = 24;

// The height of one line, which is what the column shifts by as a line lands.
// Fixed rather than measured: every row is one clipped line, so the shift is
// the same every time and the crawl stays even.
export const LOG_ROW_HEIGHT = 18;

// The index of the last entry whose value is at or before `limit`, or -1 when
// none is. A binary search rather than a walk on from the last answer, because
// the moment can move backwards — a seek, or a needle dragged left — as
// readily as forwards.
export const lastIndexAtOrBefore = (
	values: readonly number[],
	limit: number,
): number => {
	let low = 0;
	let high = values.length - 1;
	let found = -1;

	while (low <= high) {
		const mid = (low + high) >> 1;

		if (values[mid]! <= limit) {
			found = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	return found;
};

// The tail of `events` at or before `upTo`, oldest first, capped at what the
// panel can show. `events` must be in clock order — the log is read in the
// order things happened, which is not the order the log stores them in.
//
// Generic over the entry so the timeline's own rows and a movie's cut-down ones
// both go through it unchanged.
export const logEntriesUpTo = <T extends {t: number}>(
	events: readonly T[],
	upTo: number,
): T[] => {
	const last = lastIndexAtOrBefore(
		events.map(event => event.t),
		upTo,
	);

	if (last < 0) return [];

	return events.slice(Math.max(0, last - LOG_LINES + 1), last + 1);
};

// A seek can replace the whole column at once. Sliding that far would be a
// swipe rather than a crawl, so the shift is capped at what an ordinary step
// can be — one line, or a line and the day header it brought with it.
const MAX_CRAWL_ROWS = 2;

// The column slides up by however many rows joined the bottom, rather than the
// stack jumping. Run off the element rather than through a CSS animation: lines
// can arrive faster than the animation is long, and a restart has to be a
// restart.
export const crawlShiftFrames = (rows: number): Keyframe[] => [
	{
		transform: `translateY(${
			Math.min(rows, MAX_CRAWL_ROWS) * LOG_ROW_HEIGHT
		}px)`,
	},
	{transform: 'translateY(0)'},
];

export const CRAWL_TIMING: KeyframeAnimationOptions = {
	duration: 220,
	easing: 'ease-out',
};

// Mounted with the panel, so it carries its own entrance rather than depending
// on a player being up to define it.
export const EVENT_LOG_KEYFRAMES = `
@keyframes epiqLogLine {
	from { opacity: 0; }
	to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
	@keyframes epiqLogLine { from { opacity: 1; } to { opacity: 1; } }
}
`;
