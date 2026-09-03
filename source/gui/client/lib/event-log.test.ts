import {describe, expect, it} from 'vitest';
import {
	buildLogEntries,
	daysToOpen,
	groupByDay,
	isDayOpen,
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

	// The cap is on the document as much as on the reading: rows above it have
	// scrolled out of the fade, and keeping them would grow the panel by a node
	// per event for as long as it is open.
	it('never holds more lines than the panel can show', () => {
		const entries = logEntriesUpTo(events, Infinity);

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
});

const commit = (sha: string, time: number): GuiCommitEntry => ({
	sha,
	time,
	author: 'jo',
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
	issue: null,
	action: null,
	sha: null,
});

describe('groupByDay', () => {
	const rows = [
		row('a', on(1, 9)),
		row('b', on(1, 17)),
		row('c', on(2, 9)),
	];

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
		const days = groupByDay([
			row('a', on(1, 23)),
			row('b', on(1, 23) + DAY),
		]);

		expect(days).toHaveLength(2);
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
