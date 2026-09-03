import {describe, expect, it} from 'vitest';
import {
	buildLogEntries,
	lastIndexAtOrBefore,
	LOG_LINES,
	logEntriesUpTo,
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
