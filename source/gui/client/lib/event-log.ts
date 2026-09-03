// The log panel's own logic: which lines it holds, and how the column moves as
// they arrive. Not theatre's, though a movie is one of the three things that
// can drive it — the panel is on the board whenever its box is ticked.
//
// One rule throughout: the last few events at or before the moment the board is
// standing at. What supplies that moment differs — the playhead while a movie
// runs, the checkout while the needle is parked, the present while live — but
// the slice does not.

import {formatDate, formatDayLabel} from '../../../lib/utils/date.utils.js';
import {GuiCommitEntry, GuiEventTimelineEntry} from './gui-state.model';
import {EVENT_CATEGORY_COLORS, GUI_THEME, TEXT} from './gui-theme';
import {LOG_ROW_SELECTOR} from './log-destination';
import {categoryOf} from './scrubber';

// One line of the log. `color` is the dot it is marked with, which is the whole
// of what says a line is a commit rather than a board event — so it is resolved
// once here rather than being decided again wherever a row is drawn.
export type LogEntry = {
	id: string;
	t: number;
	label: string;
	color: string;
	// What the line was about, which is all a click needs to find its way — see
	// lib/log-destination. Copied off the source entry rather than worked out
	// here: every event in the window becomes one of these, and at most one of
	// them is ever followed.
	//
	// A board- or swimlane-level event has no ticket and leads nowhere.
	issue: string | null;
	action: string | null;
	sha: string | null;
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
			issue: event.issue,
			action: event.action,
			sha: null,
		})),
		// Prefixed, because a sha and a ULID share no namespace and both end up
		// as React keys in the same column.
		...commits.map(commit => ({
			id: `commit-${commit.sha}`,
			t: commit.time,
			label: commit.subject,
			color: GUI_THEME.green,
			// A commit belongs to whichever ticket its subject is prefixed with,
			// which the board resolves when the line is clicked — it already has to,
			// for the scatter's own commit dots.
			issue: null,
			action: null,
			sha: commit.sha,
		})),
	].sort((left, right) => left.t - right.t);

// How many lines the panel is handed. Well past what one pane shows, because
// the pane scrolls and reaching back through it is the point — and because
// folding, not this, is now what bounds the document: a folded day is one row
// however many events it holds, so the rows actually mounted are the open
// days' and nothing else.
//
// Still a hard cap, so the panel costs the same on a decade of history as on
// an hour.
export const LOG_LINES = 400;

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

// One day's worth of the log, which is the unit the panel folds by.
export type LogDay = {
	// Stable across re-slices, so a day left open stays open as lines arrive.
	key: string;
	label: string;
	entries: LogEntry[];
};

// Split into days, oldest first, each already labelled the way its divider
// reads. Grouped here rather than in the panel so what a day *is* — and what
// identifies it across renders — is settled in one place.
export const groupByDay = (entries: readonly LogEntry[]): LogDay[] => {
	const days: LogDay[] = [];

	for (const entry of entries) {
		const at = new Date(entry.t);
		const key = formatDate(at);
		const last = days[days.length - 1];

		if (last?.key === key) last.entries.push(entry);
		else days.push({key, label: formatDayLabel(at), entries: [entry]});
	}

	return days;
};

// How many of the newest days to open before the pane has been measured, and
// wherever a measurement is not to be had.
export const DEFAULT_OPEN_DAYS = 3;

// How many of the newest days to open so the pane is filled. A folded day costs
// one row; an open one costs a row and its lines.
//
// The day that crosses the pane's height is opened rather than left folded: it
// is what fills the last of the pane, the overflow is scrollable, and stopping
// short of it leaves the panel mostly empty above a run of folded dates — which
// is the thing this exists to avoid. The newest day is always open for the same
// reason, however long it is.
export const daysToOpen = (
	days: readonly LogDay[],
	rowsAvailable: number,
): number => {
	let openRows = 0;
	let opened = 0;

	for (let taken = 1; taken <= days.length; taken++) {
		opened = taken;
		openRows += 1 + days[days.length - taken]!.entries.length;

		if (openRows + (days.length - taken) >= rowsAvailable) break;
	}

	return opened;
};

// Whether a day's lines are shown. The newest `openCount` days are, until a
// reader says otherwise — and their say has to outlive the slice moving, which
// is why the override is keyed by day rather than by index.
export const isDayOpen = (
	days: readonly LogDay[],
	index: number,
	overrides: ReadonlyMap<string, boolean>,
	openCount: number,
): boolean =>
	overrides.get(days[index]!.key) ?? index >= days.length - openCount;

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

// A line is one element. Its clock and its dot are drawn as pseudo-elements
// off the row itself rather than as spans inside it, which is the difference
// between four nodes a line and one — and the panel can hold hundreds.
//
// The clock is `attr()`ed off the row, the dot's colour comes in as a custom
// property, and both are laid out in `ch` so the columns hold at whatever size
// the row's font ends up.
export const LOG_TIME_CHARS = 5;
export const LOG_DOT_COLOR_PROPERTY = '--epiq-log-dot';

// The gap between the column of lines and either side of the panel. Shared
// with the arrow below, which hangs at the end of a line rather than at the
// edge of the panel it happens to be drawn in.
export const LOG_PANE_PADDING_X = 14;

// The rows that lead somewhere, and only those. The attribute names belong to
// `log-destination` — it hands over the selector rather than the names, so
// what these rules point at cannot drift from what a click follows.
const linkedRow = (suffix = ''): string =>
	LOG_ROW_SELECTOR.split(',')
		.map(attribute => `.epiq-log-line${attribute}${suffix}`)
		.join(',');

// One arrow for the whole panel, moved onto whichever row is hovered — see
// EventLog, and the same node budget the pseudo-elements above are about. It
// is decorative: the row is the target, so nothing here takes a pointer.
export const LOG_ARROW_CLASS = 'epiq-log-arrow';

// Mounted with the panel, so it carries its own look rather than depending on
// a player being up to define it.
export const EVENT_LOG_STYLES = `
.epiq-log-line {
	position: relative;
	height: ${LOG_ROW_HEIGHT}px;
	line-height: ${LOG_ROW_HEIGHT}px;
	font-size: ${TEXT.meta}px;
	color: ${GUI_THEME.secondary};
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	animation: epiqLogLine 260ms ease-out;
}
.epiq-log-line::before {
	content: attr(data-time);
	display: inline-block;
	width: ${LOG_TIME_CHARS}ch;
	margin-right: 14px;
	color: ${GUI_THEME.dim2};
	font-variant-numeric: tabular-nums;
}
.epiq-log-line::after {
	content: '';
	position: absolute;
	left: calc(${LOG_TIME_CHARS}ch + 4px);
	top: 50%;
	width: 5px;
	height: 5px;
	margin-top: -2.5px;
	border-radius: 50%;
	background: var(${LOG_DOT_COLOR_PROPERTY});
}
${linkedRow()} {
	cursor: pointer;
}
${linkedRow(':hover')} {
	color: ${GUI_THEME.primary};
	background: ${GUI_THEME.hover};
}
.${LOG_ARROW_CLASS} {
	position: absolute;
	right: ${LOG_PANE_PADDING_X}px;
	display: flex;
	align-items: center;
	height: ${LOG_ROW_HEIGHT}px;
	padding: 0 3px;
	border-radius: 4px;
	color: ${GUI_THEME.secondary};
	/* Opaque, so a long line is cut off behind it rather than running under —
	   and mixed exactly as the row it sits on is, so it does not read as a
	   patch laid over one. */
	background: linear-gradient(${GUI_THEME.hover}, ${GUI_THEME.hover}),
		${GUI_THEME.panel};
	opacity: 0;
	pointer-events: none;
	transition: opacity 120ms ease;
}
@keyframes epiqLogLine {
	from { opacity: 0; }
	to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
	.epiq-log-line { animation: none; }
	.${LOG_ARROW_CLASS} { transition: none; }
}
`;
