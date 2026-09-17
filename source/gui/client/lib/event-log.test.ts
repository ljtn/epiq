import {describe, expect, it} from 'vitest';
import {
	actorColumnChars,
	actorColumnWidth,
	buildLogEntries,
	daysToOpen,
	dayRowsShown,
	LOG_DAY_ROWS,
	MAX_ACTOR_CHARS,
	groupByDay,
	isDayOpen,
	touchedLines,
	lastIndexAtOrBefore,
	LOG_LINES,
	logEntriesUpTo,
	LogEntry,
} from './event-log';
import {GuiCommitEntry, GuiEventTimelineEntry} from './gui-state.model';
import {EVENT_CATEGORY_COLORS, GUI_THEME} from './gui-theme';

const at = (id: string, t: number) => ({id, t, label: `event ${id}`});

describe('lastIndexAtOrBefore', () => {
	const values = [10, 20, 30];
	const self = (value: number) => value;

	it('is -1 when nothing is at or before the limit', () => {
		expect(lastIndexAtOrBefore(values, 9, self)).toBe(-1);
		expect(lastIndexAtOrBefore([], 100, self)).toBe(-1);
	});

	it('includes the value that sits exactly on the limit', () => {
		expect(lastIndexAtOrBefore(values, 10, self)).toBe(0);
		expect(lastIndexAtOrBefore(values, 30, self)).toBe(2);
	});

	it('holds the last one passed between two values', () => {
		expect(lastIndexAtOrBefore(values, 29, self)).toBe(1);
	});

	it('takes everything for a limit past the end', () => {
		expect(lastIndexAtOrBefore(values, Infinity, self)).toBe(2);
	});

	// The reason it reads through an accessor: this runs in a render that
	// repeats every animation frame, and projecting the values into an array
	// first would put an O(n) walk in front of the search.
	it('reads only the items the search visits', () => {
		const seen: number[] = [];
		lastIndexAtOrBefore(values, 25, value => {
			seen.push(value);
			return value;
		});

		expect(seen.length).toBeLessThan(values.length);
	});
});

describe('logEntriesUpTo', () => {
	const events = Array.from({length: LOG_LINES + 10}, (_, index) =>
		at(`e${index}`, 1000 + index),
	);

	it('is empty before the first event has happened', () => {
		expect(logEntriesUpTo(events, 999)).toEqual([]);
	});

	it('reads oldest first, ending on the event at the moment asked for', () => {
		expect(logEntriesUpTo(events, 1003).map(event => event.id)).toEqual([
			'e0',
			'e1',
			'e2',
			'e3',
		]);
	});

	// The chart beside it draws every event in the window, so a log that stopped
	// short of the chart's left edge could not be scrolled back to meet it.
	// What is mounted is bounded by the day fold and by `dayRowsShown`, not here.
	it('covers the whole window when nothing is playing', () => {
		const entries = logEntriesUpTo(events, Infinity);

		expect(entries).toHaveLength(events.length);
		expect(entries[0]!.id).toBe(events[0]!.id);
		expect(entries[entries.length - 1]!.id).toBe(events[events.length - 1]!.id);
	});

	// A movie re-slices every animation frame against a 16.7ms budget, already
	// paying for a checkout per event and the board's own re-render.
	it('holds no more than the panel can show while playing', () => {
		const entries = logEntriesUpTo(events, Infinity, true);

		expect(entries).toHaveLength(LOG_LINES);
		expect(entries[entries.length - 1]!.id).toBe(events[events.length - 1]!.id);
	});

	// One rule for all three of live, scrubbed and playing — only the moment
	// handed to it differs, so moving that moment backwards has to take the log
	// back with it.
	it('follows the moment backwards as readily as forwards', () => {
		expect(logEntriesUpTo(events, 1002).map(event => event.id)).toEqual([
			'e0',
			'e1',
			'e2',
		]);
	});

	it('takes the whole tail of the window for a moment past its end', () => {
		const live = logEntriesUpTo(events, Infinity);
		const parked = logEntriesUpTo(events, events[events.length - 1]!.t);

		expect(live).toEqual(parked);
	});
});

const event = (
	id: string,
	t: number,
	action: string,
): GuiEventTimelineEntry => ({
	id,
	t,
	action,
	label: `event ${id}`,
	actor: null,
	tag: null,
	assignee: null,
	issue: null,
	lane: null,
	laneBefore: null,
});

const commit = (sha: string, time: number): GuiCommitEntry => ({
	sha,
	time,
	author: 'jo',
	authorEmail: 'someone@example.com',
	subject: `commit ${sha}`,
	linesChanged: 3,
	insertions: 2,
	deletions: 1,
});

describe('buildLogEntries', () => {
	it('interleaves commits with events by the clock', () => {
		const rows = buildLogEntries(
			[event('a', 100, 'create.issue'), event('b', 300, 'create.issue')],
			[commit('sha1', 200)],
		);

		expect(rows.map(row => row.id)).toEqual(['a', 'commit-sha1', 'b']);
	});

	// A sha and a ULID share no namespace, and both end up as React keys in one
	// column.
	it('keeps commit ids from colliding with event ids', () => {
		const rows = buildLogEntries(
			[event('sha1', 1, 'create.issue')],
			[commit('sha1', 2)],
		);

		expect(new Set(rows.map(row => row.id)).size).toBe(2);
	});

	it('signs an event with its actor and a commit with its author', () => {
		const signed = {
			...event('a', 1, 'create.issue'),
			actor: {id: 'u1', name: 'jola', color: '#abc'},
		};
		const rows = buildLogEntries([signed], [commit('sha1', 2)]);

		expect(rows[0]!.actor).toEqual({name: 'jola'});
		// An author has no colour on the board, so the line lends its own.
		expect(rows[1]!.actor).toEqual({name: 'jo'});
	});

	it('carries a commit\u2019s line counts, and nothing for an event', () => {
		const rows = buildLogEntries(
			[event('a', 1, 'create.issue')],
			[commit('sha1', 2)],
		);

		expect(rows[0]!.diff).toBeNull();
		expect(rows[1]!.diff).toEqual({insertions: 2, deletions: 1});
	});

	it('leaves an unsigned event with no actor', () => {
		const rows = buildLogEntries([event('a', 1, 'create.issue')], []);

		expect(rows[0]!.actor).toBeNull();
	});

	it('marks a commit with the green its dots already have on the chart', () => {
		const rows = buildLogEntries([], [commit('sha1', 1)]);

		expect(rows[0]!.color).toBe(GUI_THEME.green);
		expect(rows[0]!.label).toBe('commit sha1');
	});

	// The same colour the scatter gives the kind, so a line reads the same in
	// both places.
	it('marks a board event with its category colour', () => {
		const rows = buildLogEntries(
			[
				event('a', 1, 'add.issue.comment'),
				event('b', 2, 'add.issue.tag'),
				event('c', 3, 'add.issue.assignee'),
				event('d', 4, 'create.issue'),
			],
			[],
		);

		expect(rows.map(row => row.color)).toEqual([
			EVENT_CATEGORY_COLORS.comments,
			EVENT_CATEGORY_COLORS.tagging,
			EVENT_CATEGORY_COLORS.assigning,
			EVENT_CATEGORY_COLORS.tickets,
		]);
	});
});

const DAY = 24 * 60 * 60 * 1000;
const on = (day: number, hour: number) =>
	new Date(2026, 8, day, hour).getTime();

// Grouping and folding care about a row's day and nothing else, so where these
// tests build rows by hand they say only that much. What a row links to is
// log-destination's, and is tested there.
const row = (id: string, t: number, label = id): LogEntry => ({
	id,
	t,
	label,
	color: '#111',
	actor: null,
	diff: null,
	issue: null,
	action: null,
	sha: null,
});

describe('actorColumnChars', () => {
	const signed = (id: string, name: string): LogEntry => ({
		...row(id, 1),
		actor: {name},
	});

	it('is the widest name in the slice', () => {
		expect(
			actorColumnChars([signed('a', 'jo'), signed('b', 'Jonatan Lampa')]),
		).toBe('Jonatan Lampa'.length);
	});

	// An agent's name is drawn without its provider, and the column is sized to
	// that rather than to the prefix it no longer shows.
	it('measures an agent by the name it shows, not by its prefix', () => {
		expect(actorColumnChars([signed('a', 'claude/tester')])).toBe(
			'/tester'.length,
		);
	});

	it('is zero when nobody signed anything', () => {
		expect(actorColumnChars([row('a', 1)])).toBe(0);
		expect(actorColumnChars([])).toBe(0);
	});

	// One long name must not push every label off the right edge.
	it('is capped', () => {
		expect(actorColumnChars([signed('a', 'x'.repeat(80))])).toBe(
			MAX_ACTOR_CHARS,
		);
	});
});

// A merge, or a tag's empty commit, has no stat to show.
describe('touchedLines', () => {
	it('is whether a commit changed any line at all', () => {
		expect(touchedLines({insertions: 0, deletions: 0})).toBe(false);
		expect(touchedLines({insertions: 0, deletions: 1})).toBe(true);
	});
});

describe('actorColumnWidth', () => {
	// A column with nothing in it keeps no gap open either.
	it('folds to nothing at zero', () => {
		expect(actorColumnWidth(0)).toBe('0px');
	});

	it('holds the name and the gap after it', () => {
		expect(actorColumnWidth(13)).toBe('calc(13ch + 8px)');
	});
});

describe('groupByDay', () => {
	const rows = [row('a', on(1, 9)), row('b', on(1, 17)), row('c', on(2, 9))];

	it('splits into days, oldest first, keeping each day whole', () => {
		const days = groupByDay(rows);

		expect(days.map(day => day.entries.map(entry => entry.id))).toEqual([
			['a', 'b'],
			['c'],
		]);
	});

	it('labels each day the way its divider reads', () => {
		expect(groupByDay(rows)[0]!.label).toBe('Tue, Sep 1');
	});

	// The key is what a fold is remembered against, so it has to name the day
	// rather than a position in a slice that keeps moving.
	it('keys a day by the day itself', () => {
		const days = groupByDay(rows);

		expect(days.map(day => day.key)).toEqual(['2026-09-01', '2026-09-02']);
	});

	it('is empty for no entries', () => {
		expect(groupByDay([])).toEqual([]);
	});

	// Two events a day apart to the minute are still two days.
	it('splits on the calendar day, not on elapsed time', () => {
		const days = groupByDay([row('a', on(1, 23)), row('b', on(1, 23) + DAY)]);

		expect(days).toHaveLength(2);
	});
});

describe('dayRowsShown', () => {
	const dayOf = (count: number) => ({
		key: 'd1',
		label: 'Mon',
		entries: Array.from({length: count}, (_, index) =>
			row(`e${index}`, on(1, 9)),
		),
	});

	it('shows a day whole while it fits', () => {
		const day = dayOf(LOG_DAY_ROWS);

		expect(dayRowsShown(day, false)).toEqual({
			shown: day.entries,
			hidden: 0,
		});
	});

	// The day fold bounds the document across days; nothing bounded it within
	// one, and `daysToOpen` always opens the newest day whole.
	it('holds back the oldest rows of a day past the bound', () => {
		const day = dayOf(LOG_DAY_ROWS + 25);
		const {shown, hidden} = dayRowsShown(day, false);

		expect(hidden).toBe(25);
		expect(shown).toHaveLength(LOG_DAY_ROWS);
		// The newest, since the log is read from the bottom.
		expect(shown[shown.length - 1]!.id).toBe(`e${LOG_DAY_ROWS + 24}`);
		expect(shown[0]!.id).toBe('e25');
	});

	it('shows the day whole once the reader has asked for it', () => {
		const day = dayOf(LOG_DAY_ROWS + 25);

		expect(dayRowsShown(day, true)).toEqual({
			shown: day.entries,
			hidden: 0,
		});
	});
});

describe('isDayOpen', () => {
	const days = groupByDay([
		row('a', on(1, 9)),
		row('b', on(2, 9)),
		row('c', on(3, 9)),
	]);

	it('opens the newest days and folds the rest', () => {
		const none = new Map<string, boolean>();

		expect([0, 1, 2].map(i => isDayOpen(days, i, none, 1))).toEqual([
			false,
			false,
			true,
		]);
		expect([0, 1, 2].map(i => isDayOpen(days, i, none, 2))).toEqual([
			false,
			true,
			true,
		]);
	});

	it('lets a reader open an older day, and fold the newest', () => {
		const overrides = new Map([
			['2026-09-01', true],
			['2026-09-03', false],
		]);

		expect([0, 1, 2].map(i => isDayOpen(days, i, overrides, 1))).toEqual([
			true,
			false,
			false,
		]);
	});

	// The override is keyed by day precisely so that it survives the slice
	// moving: a day opened by hand stays open as new lines push others off.
	it('keeps a day open once the newest day is a different one', () => {
		const overrides = new Map([['2026-09-02', true]]);
		const later = groupByDay([
			row('b', on(2, 9)),
			row('c', on(3, 9)),
			row('d', on(4, 9)),
		]);

		expect(isDayOpen(later, 0, overrides, 1)).toBe(true);
	});
});

describe('daysToOpen', () => {
	const dayOf = (day: number, lines: number) =>
		Array.from({length: lines}, (_, index) =>
			row(`d${day}-${index}`, on(day, 9) + index * 1000, 'x'),
		);

	// Three days of four lines each: an open day costs its lines plus its
	// divider, a folded one costs the divider alone.
	const days = groupByDay([...dayOf(1, 4), ...dayOf(2, 4), ...dayOf(3, 4)]);

	it('opens the newest days until the pane is full', () => {
		// One open day is 1 + 4 rows, plus 2 for the days still folded: 7, which
		// leaves a tall pane with room to spare.
		expect(daysToOpen(days, 20)).toBe(3);
		expect(daysToOpen(days, 11)).toBe(2);
	});

	// Stopping short of it would leave the panel mostly empty above a run of
	// folded dates, which is the thing this exists to avoid — and the overflow
	// is scrollable.
	it('opens the day that crosses the pane rather than leaving a gap', () => {
		expect(daysToOpen(days, 10)).toBe(2);
	});

	// Otherwise a pane too short for one day would open on a list of dates.
	it('always opens the newest day, however little room there is', () => {
		expect(daysToOpen(days, 1)).toBe(1);
		expect(daysToOpen(days, 0)).toBe(1);
	});

	it('is nothing to open for an empty log', () => {
		expect(daysToOpen([], 40)).toBe(0);
	});
});
