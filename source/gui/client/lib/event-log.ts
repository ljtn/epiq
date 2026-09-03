// The log panel's own logic: which lines it holds, and how the column moves as
// they arrive. Not theatre's, though a movie is one of the three things that
// can drive it — the panel is on the board whenever its box is ticked.
//
// One rule throughout: the last few events at or before the moment the board is
// standing at. What supplies that moment differs — the playhead while a movie
// runs, the checkout while the needle is parked, the present while live — but
// the slice does not.

import {GuiCommitEntry, GuiEventTimelineEntry} from './gui-state.model';
import {EVENT_CATEGORY_COLORS, GUI_THEME} from './gui-theme';
import {categoryOf} from './scrubber';

// One line of the log. `color` is the dot it is marked with, which is the whole
// of what says a line is a commit rather than a board event — so it is resolved
// once here rather than being decided again wherever a row is drawn.
export type LogEntry = {
	id: string;
	t: number;
	label: string;
	color: string;
};

// Both series in one column, in clock order. Commits are lines and nothing
// more: they change no board state, so they never drive a checkout and never
// become a frame of a movie — the playhead is still walked by events alone.
export const buildLogEntries = (
	events: readonly GuiEventTimelineEntry[],
	commits: readonly GuiCommitEntry[],
): LogEntry[] =>
	[
		...events.map(event => ({
			id: event.id,
			t: event.t,
			label: event.label,
			// The colour its dot already has on the scatter, so a kind reads the
			// same in both places.
			color: EVENT_CATEGORY_COLORS[categoryOf(event.action)],
		})),
		// Prefixed, because a sha and a ULID share no namespace and both end up
		// as React keys in the same column.
		...commits.map(commit => ({
			id: `commit-${commit.sha}`,
			t: commit.time,
			label: commit.subject,
			color: GUI_THEME.green,
		})),
	].sort((left, right) => left.t - right.t);

// How many lines the panel is handed. Enough to fill a tall pane to its top —
// the panel is a column of the board's full height, and a log that stopped
// short of it would read as a box parked at the bottom rather than as the
// board's log.
//
// Still a hard cap on the document, which is the point: what the pane cannot
// show is clipped into the fade, and the panel costs these rows on a year of
// history exactly as on an hour. Rows past the pane's height are the only
// waste, and eighty of them is nothing next to a board of cards.
export const LOG_LINES = 80;

// The height of one line, which is what the column shifts by as a line lands.
// Fixed rather than measured: every row is one clipped line, so the shift is
// the same every time and the crawl stays even.
export const LOG_ROW_HEIGHT = 18;

// The index of the last item whose value is at or before `limit`, or -1 when
// none is. A binary search rather than a walk on from the last answer, because
// the moment can move backwards — a seek, or a needle dragged left — as
// readily as forwards.
//
// Reads the value through `valueOf` rather than taking an array of numbers:
// this runs in a render that repeats every animation frame of a movie, and
// projecting twenty thousand timestamps into a fresh array first would be an
// O(n) walk in front of the O(log n) search that follows it.
export const lastIndexAtOrBefore = <T>(
	items: readonly T[],
	limit: number,
	valueOf: (item: T) => number,
): number => {
	let low = 0;
	let high = items.length - 1;
	let found = -1;

	while (low <= high) {
		const mid = (low + high) >> 1;

		if (valueOf(items[mid]!) <= limit) {
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
	const last = lastIndexAtOrBefore(events, upTo, event => event.t);

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
