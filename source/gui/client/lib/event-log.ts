// The log panel's logic: the last few events at or before the moment the
// board stands at, whether playhead, checkout or present.

import {formatDate, formatDayLabel} from '../../../lib/utils/date.utils.js';
import {commitTicketRef} from '../../../lib/utils/commit-ref.js';
import {nodeRef} from '../../../lib/utils/node-ref.js';
import {commitAuthorLabel} from './commit-author';
import {actorDisplayChars} from './agent-identity';
import {
	GuiCommitEntry,
	GuiEventTimelineEntry,
	GuiIssueHistoryEntry,
} from './gui-state.model';
import {EVENT_CATEGORY_COLORS, GUI_THEME, TEXT} from './gui-theme';
import {LOG_ROW_SELECTOR} from './log-destination';
import {categoryOf} from './scrubber';

// One line of the log. `color` is the dot, which alone marks a commit.
export type LogEntry = {
	id: string;
	t: number;
	label: string;
	// The ticket ref the label opens with, drawn quieter than the rest of it.
	// Null where it opens with none.
	ref: string | null;
	color: string;
	// The event's actor, or a commit's author in the panel's text colour. Null
	// when unsigned.
	actor: {name: string} | null;
	// What a commit did to the code, for the stat beside its subject. Null on
	// a board event, which touched no file.
	diff: {insertions: number; deletions: number} | null;
	// What the line is about, for a click (see lib/log-destination). Null for
	// board- and swimlane-level events.
	issue: string | null;
	// The comment the event was about, where it was about one — see
	// lib/log-destination, which turns it into an anchor.
	target: string | null;
	action: string | null;
	sha: string | null;
};

// Prefixed, because a sha and a ULID share no namespace and both end up
// as React keys in the same column.
const commitLogEntry = (
	commit: GuiCommitEntry,
	knownRefs: ReadonlySet<string> = new Set(),
): LogEntry => ({
	id: `commit-${commit.sha}`,
	t: commit.time,
	label: commit.subject,
	ref: commitTicketRef(commit.subject, knownRefs)
		? commit.subject.trim().split(/\s+/)[0]!
		: null,
	color: GUI_THEME.green,
	// The same label the scrubber gives this commit.
	actor: {name: commitAuthorLabel(commit)},
	diff: {insertions: commit.insertions, deletions: commit.deletions},
	// Resolved from subject prefix or Epiq-Ref when the line is clicked.
	issue: null,
	target: null,
	action: null,
	sha: commit.sha,
});

// Both series in clock order. Commits change no board state, so they never
// drive a checkout or a movie frame.
export const buildLogEntries = (
	events: readonly GuiEventTimelineEntry[],
	commits: readonly GuiCommitEntry[],
	knownRefs: ReadonlySet<string> = new Set(),
): LogEntry[] =>
	[
		...events.map(event => ({
			id: event.id,
			t: event.t,
			label: event.label,
			ref: labelRef(event),
			// The colour its dot already has on the scatter, so a kind reads the
			// same in both places.
			color: EVENT_CATEGORY_COLORS[categoryOf(event.action)],
			actor: event.actor ? {name: event.actor.name} : null,
			diff: null,
			issue: event.issue,
			target: event.target,
			action: event.action,
			sha: null,
		})),
		...commits.map(commit => commitLogEntry(commit, knownRefs)),
	].sort((left, right) => left.t - right.t);

const labelRef = (event: GuiEventTimelineEntry): string | null => {
	const ref = event.issue ? nodeRef(event.issue) : null;

	return ref && event.label.startsWith(`${ref} `) ? ref : null;
};

// A ticket's own history and commits as log lines, in clock order. They lead
// nowhere: they are already about the ticket they are shown on.
export const issueActivityLogEntries = (
	history: readonly GuiIssueHistoryEntry[],
	commits: readonly GuiCommitEntry[],
): LogEntry[] =>
	[
		...history.map(entry => ({
			id: entry.id,
			t: entry.t,
			label: entry.label,
			ref: null,
			color: EVENT_CATEGORY_COLORS[categoryOf(entry.action)],
			actor: {name: entry.actor.name},
			diff: null,
			issue: null,
			target: null,
			action: entry.action,
			sha: null,
		})),
		...commits.map(commit => ({...commitLogEntry(commit), sha: null})),
	].sort((left, right) => left.t - right.t);

// The longest name in the slice, capped at MAX_ACTOR_CHARS; zero when unsigned.
export const actorColumnChars = (entries: readonly LogEntry[]): number => {
	let widest = 0;

	for (const entry of entries) {
		// As drawn, not as stored: an agent's name loses its provider prefix.
		if (entry.actor) {
			widest = Math.max(widest, actorDisplayChars(entry.actor.name));
		}
	}

	return Math.min(widest, MAX_ACTOR_CHARS);
};

// A commit that changed no line — a merge, or a tag's empty commit — shows no
// stat.
export const touchedLines = (diff: {
	insertions: number;
	deletions: number;
}): boolean => diff.insertions + diff.deletions > 0;

// Nothing at all when unsigned, so no blank column stays open.
const LOG_COLUMN_GAP_PX = 8;

export const actorColumnWidth = (chars: number): string =>
	chars === 0 ? '0px' : `calc(${chars}ch + ${LOG_COLUMN_GAP_PX}px)`;

// Each day's own: a long name on one day does not widen every other day's.
export const actorColumnWidthsByDay = (days: readonly LogDay[]): string[] =>
	days.map(day => actorColumnWidth(actorColumnChars(day.entries)));

// How many lines the panel is handed; a hard cap, while day folding bounds
// what is mounted.
export const LOG_LINES = 400;

// Fixed rather than measured, so the crawl stays even.
export const LOG_ROW_HEIGHT = 18;

// The index of the last item at or before `limit`, or -1. A binary search,
// since the moment can move backwards; `valueOf` avoids projecting an array.
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

// The stretch of `events` (in clock order) at or before `upTo`, oldest first.
// `capped` is for playback only, which re-slices every frame.
export const logEntriesUpTo = <T extends {t: number}>(
	events: readonly T[],
	upTo: number,
	capped = false,
): T[] => {
	const last = lastIndexAtOrBefore(events, upTo, event => event.t);

	if (last < 0) return [];

	const from = capped ? Math.max(0, last - LOG_LINES + 1) : 0;

	return events.slice(from, last + 1);
};

// One day's worth of the log, which is the unit the panel folds by.
export type LogDay = {
	// Stable across re-slices, so a day left open stays open as lines arrive.
	key: string;
	label: string;
	entries: LogEntry[];
};

// Split into days, oldest first, each labelled as its divider reads.
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

// How many of the newest days to open to fill the pane: the one crossing its
// height opens too, and the newest always does.
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

// The reader's override is keyed by day, so it survives the slice moving.
export const isDayOpen = (
	days: readonly LogDay[],
	index: number,
	overrides: ReadonlyMap<string, boolean>,
	openCount: number,
): boolean =>
	overrides.get(days[index]!.key) ?? index >= days.length - openCount;

// The most rows one open day mounts before the rest go behind "N earlier".
export const LOG_DAY_ROWS = 200;

// What an open day shows, and how many it holds back. Expanding is sticky.
export const dayRowsShown = (
	day: LogDay,
	expanded: boolean,
): {shown: LogEntry[]; hidden: number} => {
	if (expanded || day.entries.length <= LOG_DAY_ROWS) {
		return {shown: day.entries, hidden: 0};
	}

	// The newest rows, since the log is read from the bottom.
	return {
		shown: day.entries.slice(day.entries.length - LOG_DAY_ROWS),
		hidden: day.entries.length - LOG_DAY_ROWS,
	};
};

// A seek can replace the whole column; the shift is capped at a line and its
// day header.
const MAX_CRAWL_ROWS = 2;

// Run off the element rather than a CSS animation, since lines can arrive
// faster than it lasts and a restart must restart.
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

// A row draws its clock and dot as pseudo-elements, to keep nodes per line
// low; columns are in `ch`. The pane's classes (see lib/log-fields) hide them.
export const LOG_TIME_CHARS = 5;
export const LOG_DOT_COLOR_PROPERTY = '--epiq-log-dot';
export const LOG_ACTOR_CLASS = 'epiq-log-actor';
// The provider's mark in front of an agent's name — see lib/agent-identity.
export const LOG_DIFF_CLASS = 'epiq-log-diff';
export const LOG_REF_CLASS = 'epiq-log-ref';
// The name column is as wide as the widest name in its day, capped. A diff
// stat is not a column: it only pushes its own row's label.
export const LOG_ACTOR_WIDTH_PROPERTY = '--epiq-log-actor-width';

// Split, the pane is a lane per actor (see lib/log-lanes): each row carries
// its lane number, and the rules turn it into an indent and width.
export const LOG_SPLIT_CLASS = 'epiq-log--split';
export const LOG_LANES_CLASS = 'epiq-log-lanes';
export const LOG_LANE_HEAD_CLASS = 'epiq-log-lane-head';
export const LOG_LANE_COUNT_PROPERTY = '--epiq-log-lanes';
export const LOG_LANE_PROPERTY = '--epiq-log-lane';
export const LOG_LANE_WIDTH_PROPERTY = '--epiq-log-lane-width';
// The lane a line nobody signed is given: it spans them all.
export const LOG_LANE_ALL_CLASS = 'epiq-log-line--every-lane';
export const MAX_ACTOR_CHARS = 18;
const TIME_BLOCK_PROPERTY = '--epiq-log-time-block';
const LEAD_PROPERTY = '--epiq-log-lead';
const LOG_LEAD_PX = 14;

// Shared with the arrow, which hangs at the end of a line.
export const LOG_PANE_PADDING_X = 12;

// The rows that lead somewhere; the selector comes from `log-destination`.
const linkedRow = (suffix = ''): string =>
	LOG_ROW_SELECTOR.split(',')
		.map(attribute => `.epiq-log-line${attribute}${suffix}`)
		.join(',');

// One decorative arrow for the panel, moved onto the hovered row.
export const LOG_ARROW_CLASS = 'epiq-log-arrow';

// The accent, thinned to a ground.
const LOG_FOLLOWED_WASH = GUI_THEME.accentWash;

// Mounted with the panel, so it carries its own look rather than depending on
// a player being up to define it.
export const EVENT_LOG_STYLES = `
.epiq-log-pane {
	${TIME_BLOCK_PROPERTY}: ${LOG_TIME_CHARS}ch;
	${LEAD_PROPERTY}: ${LOG_LEAD_PX}px;
}
.epiq-log-line {
	position: relative;
	height: ${LOG_ROW_HEIGHT}px;
	line-height: ${LOG_ROW_HEIGHT}px;
	padding-left: calc(
		var(${TIME_BLOCK_PROPERTY}) + var(${LEAD_PROPERTY}) +
			var(${LOG_ACTOR_WIDTH_PROPERTY})
	);
	font-size: ${TEXT.meta}px;
	color: ${GUI_THEME.secondary};
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	animation: epiqLogLine 260ms ease-out;
}
.epiq-log-line::before {
	content: attr(data-time);
	position: absolute;
	left: 0;
	top: 0;
	width: var(${TIME_BLOCK_PROPERTY});
	color: ${GUI_THEME.faint};
	font-variant-numeric: tabular-nums;
}
.epiq-log-line::after {
	content: '';
	position: absolute;
	left: calc(var(${TIME_BLOCK_PROPERTY}) + 4px);
	top: 50%;
	width: 5px;
	height: 5px;
	margin-top: -2.5px;
	border-radius: 50%;
	background: var(${LOG_DOT_COLOR_PROPERTY});
}
.${LOG_ACTOR_CLASS} {
	position: absolute;
	color: ${GUI_THEME.dim};
	top: 0;
	left: calc(var(${TIME_BLOCK_PROPERTY}) + var(${LEAD_PROPERTY}));
	width: calc(var(${LOG_ACTOR_WIDTH_PROPERTY}) - ${LOG_COLUMN_GAP_PX}px);
	overflow: hidden;
	text-overflow: ellipsis;
}
.${LOG_REF_CLASS} {
	color: ${GUI_THEME.faint};
}
.${LOG_DIFF_CLASS} {
	display: inline-flex;
	align-items: center;
	height: ${LOG_ROW_HEIGHT}px;
	margin-right: ${LOG_COLUMN_GAP_PX}px;
	vertical-align: top;
}
.epiq-log--no-time {
	${TIME_BLOCK_PROPERTY}: 0px;
}
.epiq-log--no-actor {
	${LOG_ACTOR_WIDTH_PROPERTY}: 0px;
}
.epiq-log--no-time .epiq-log-line::before,
.epiq-log--no-kind .epiq-log-line::after,
.epiq-log--no-actor .${LOG_ACTOR_CLASS},
.epiq-log--no-diff .${LOG_DIFF_CLASS} {
	display: none;
}
.epiq-log--no-kind {
	${LEAD_PROPERTY}: 1ch;
}
.epiq-log--no-time.epiq-log--no-kind {
	${LEAD_PROPERTY}: 0px;
}
/* The line the board is standing on while following: the one whose arrival
   moved it.

   A wash across the row rather than a rule down its edge. The rule landed hard
   against the timestamp — the row's own left edge is where the time starts, not
   the panel's — and read as a text cursor sitting in the middle of the line.

   The accent at a tenth, in the same translucent idiom as the hover ground it
   has to sit under without fighting: hover says where the pointer is, this says
   where the board is, and a row can be both. */
.epiq-log-line--followed {
	color: ${GUI_THEME.primary};
	background: ${LOG_FOLLOWED_WASH};
}

${linkedRow()} {
	cursor: pointer;
}
/* Every row takes the ground under the pointer, not only the ones that lead
   somewhere: the highlight says which line the reader is on, which is a
   question every line answers. */
.epiq-log-line:hover {
	color: ${GUI_THEME.primary};
	background: ${GUI_THEME.hover};
}
/* Both at once, since both are true: the pointer is here *and* the board is
   standing here. Spelled out because the hover rule above outranks the wash on
   specificity and would otherwise replace it outright — the reader would lose
   the mark by pointing at the row it is on. */
.epiq-log-line--followed:hover {
	color: ${GUI_THEME.primary};
	background: linear-gradient(${GUI_THEME.hover}, ${GUI_THEME.hover}),
		${LOG_FOLLOWED_WASH};
}
.${LOG_ARROW_CLASS} {
	position: absolute;
	right: ${LOG_PANE_PADDING_X}px;
	display: flex;
	align-items: center;
	/* The word and the mark read as one affordance rather than two things that
	   happen to be adjacent. */
	gap: 4px;
	height: ${LOG_ROW_HEIGHT}px;
	padding: 0 5px;
	border-radius: 4px;
	color: ${GUI_THEME.secondary};
	/* Opaque, so a long line is cut off behind it rather than running under —
	   and mixed exactly as the row it sits on is, so it does not read as a
	   patch laid over one. */
	background: linear-gradient(${GUI_THEME.hover}, ${GUI_THEME.hover}),
		${GUI_THEME.panel};
	/* Every row is positioned too, and they all come after this one in the
	   pane, so on paint order alone the opaque ground above would sit *under*
	   the very text it is there to cut off. */
	z-index: 1;
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
.${LOG_SPLIT_CLASS} {
	${LOG_ACTOR_WIDTH_PROPERTY}: 0px;
	${LOG_LANE_WIDTH_PROPERTY}: calc(
		(100% - var(${TIME_BLOCK_PROPERTY}) - var(${LEAD_PROPERTY})) /
			var(${LOG_LANE_COUNT_PROPERTY})
	);
}
/* The indent is the lanes to its left, the width is those plus its own: a
   long label is cut off at its lane's edge rather than running across the
   next actor's column. */
.${LOG_SPLIT_CLASS} .epiq-log-line {
	box-sizing: border-box;
	padding-left: calc(
		var(${TIME_BLOCK_PROPERTY}) + var(${LEAD_PROPERTY}) +
			var(${LOG_LANE_PROPERTY}) * var(${LOG_LANE_WIDTH_PROPERTY})
	);
	width: calc(
		var(${TIME_BLOCK_PROPERTY}) + var(${LEAD_PROPERTY}) +
			(var(${LOG_LANE_PROPERTY}) + 1) * var(${LOG_LANE_WIDTH_PROPERTY})
	);
}
.${LOG_SPLIT_CLASS} .${LOG_LANE_ALL_CLASS} {
	width: 100%;
}
/* Out of the way rather than gone: the lane says who to somebody looking at
   it, and says nothing at all to somebody listening to it — so the name stays
   in the page for them, a pixel wide and clipped. */
.${LOG_SPLIT_CLASS} .${LOG_ACTOR_CLASS} {
	width: 1px;
	height: 1px;
	clip-path: inset(50%);
}
/* One hairline at the head of each lane, drawn behind the day's lines rather
   than on them — a border per row would be a rule broken at every gap. */
.${LOG_SPLIT_CLASS} .${LOG_LANES_CLASS} {
	/* The time block is a ch, so this box has to be set in the rows' own font
	   or its lanes come out a different width from theirs and the rules drift
	   off the lines they divide. */
	font-size: ${TEXT.meta}px;
	background-image: linear-gradient(
		to right,
		${GUI_THEME.line} 0 1px,
		transparent 1px
	);
	background-size: var(${LOG_LANE_WIDTH_PROPERTY}) 100%;
	background-position: calc(
			var(${TIME_BLOCK_PROPERTY}) + var(${LEAD_PROPERTY})
		)
		0;
	background-repeat: repeat-x;
}
/* Who each lane is, held at the top of the pane: the lines scroll under it,
   and without it a column of unsigned-looking rows says nothing about whose
   it is. */
.${LOG_LANE_HEAD_CLASS} {
	position: sticky;
	top: 0;
	z-index: 1;
	display: flex;
	height: ${LOG_ROW_HEIGHT}px;
	line-height: ${LOG_ROW_HEIGHT}px;
	margin-bottom: 2px;
	background: ${GUI_THEME.panel};
	border-bottom: 1px solid ${GUI_THEME.line};
	font-size: ${TEXT.meta}px;
}
/* The lead is the first name's margin rather than the row's padding: a lane's
   width is a share of this box, so padding here would measure every lane
   against a narrower box than the lines are and walk the headings off their
   own lanes, further with each one. */
.${LOG_LANE_HEAD_CLASS} > span {
	flex: 0 0 var(${LOG_LANE_WIDTH_PROPERTY});
	/* A heading, so it is read once and sits at the lines' own weight rather
	   than at the signatures' quieter one. In nobody's colour either: the lane
	   is the column, not the tint. */
	color: ${GUI_THEME.secondary};
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}
.${LOG_LANE_HEAD_CLASS} > span:first-child {
	margin-left: calc(var(${TIME_BLOCK_PROPERTY}) + var(${LEAD_PROPERTY}));
}
`;
