import {describe, expect, it} from 'vitest';
import {
	GuiEventTimeline,
	GuiEventTimelineEntry,
	GuiTimeTravelStatus,
} from './gui-state.model';
import {eventsWentUnlisted, momentOnScreen, onThisBoard} from './use-event-log';

const live: GuiTimeTravelStatus = {mode: 'live', asOfTime: null};
const parked: GuiTimeTravelStatus = {mode: 'scrub', asOfTime: 5_000};

describe('momentOnScreen', () => {
	it('stands at the present while the board is live', () => {
		expect(momentOnScreen(false, null, live)).toBe(Infinity);
		expect(momentOnScreen(false, null, undefined)).toBe(Infinity);
	});

	it('follows the needle while the board is parked in the past', () => {
		expect(momentOnScreen(false, null, parked)).toBe(5_000);
	});

	it('follows the playhead while a movie runs', () => {
		expect(momentOnScreen(true, 1_234, live)).toBe(1_234);
	});

	// A movie opens on the board as it was before any of it happened, which is a
	// real position — not the absence of a movie, and not the present.
	it('stands before every event while a movie has yet to reach its first', () => {
		expect(momentOnScreen(true, null, live)).toBe(-Infinity);
	});

	// The playhead outranks a checkout: a movie is itself a run of checkouts, so
	// the board reports `scrub` throughout one.
	it('prefers the playhead to the checkout it is made of', () => {
		expect(momentOnScreen(true, 1_234, parked)).toBe(1_234);
		expect(momentOnScreen(true, null, parked)).toBe(-Infinity);
	});
});

const entry = (board: string | null): GuiEventTimelineEntry => ({
	id: 'e1',
	t: 1,
	action: 'add.issue',
	label: 'filed a ticket',
	actor: null,
	tag: null,
	assignee: null,
	issue: 'ISSUE_1',
	board,
	lane: null,
	laneBefore: null,
});

describe('onThisBoard', () => {
	it('keeps a line belonging to the board on screen', () => {
		expect(onThisBoard(entry('BOARD_A'), 'BOARD_A')).toBe(true);
	});

	// The whole of S021YSM: a foreign line's route is built from the board on
	// screen, so it leads to a ticket that board does not hold.
	it('drops a line belonging to another board', () => {
		expect(onThisBoard(entry('BOARD_B'), 'BOARD_A')).toBe(false);
	});

	// A contributor claim decides who the commits on every board belong to, so
	// it resolves to no board and has to be read as belonging to all of them.
	it('keeps a line that belongs to no board, on every board', () => {
		expect(onThisBoard(entry(null), 'BOARD_A')).toBe(true);
		expect(onThisBoard(entry(null), 'BOARD_B')).toBe(true);
	});

	// Before a board is known there is nothing to narrow to, and narrowing to
	// nothing would empty the panel rather than leave it unfiltered.
	it('keeps everything while no board is known', () => {
		expect(onThisBoard(entry('BOARD_B'), null)).toBe(true);
	});
});

const window = (capped: boolean): GuiEventTimeline => ({
	bucketMs: 1_000,
	buckets: [],
	capped,
	events: [],
	lanesAtStart: {},
	laneNames: {},
	closedLane: 'CLOSED',
	earliest: 0,
	latest: 10_000,
});

describe('eventsWentUnlisted', () => {
	it('says nothing about a window the server listed in full', () => {
		expect(eventsWentUnlisted(true, true, window(false))).toBe(false);
	});

	// The whole of 8CYH2TC: past the cap the window arrives without its events,
	// and a log of commits alone reads as a quiet stretch.
	it('speaks up for a window too crowded to list', () => {
		expect(eventsWentUnlisted(true, true, window(true))).toBe(true);
	});

	// Only the board series went missing, so a reader who turned it off is
	// already seeing all they asked for.
	it('stays quiet while the board series is off', () => {
		expect(eventsWentUnlisted(true, false, window(true))).toBe(false);
	});

	it('stays quiet while the panel is shut', () => {
		expect(eventsWentUnlisted(false, true, window(true))).toBe(false);
	});

	it('stays quiet before a window has arrived', () => {
		expect(eventsWentUnlisted(true, true, null)).toBe(false);
	});
});
