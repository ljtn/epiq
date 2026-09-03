import {describe, expect, it} from 'vitest';
import {buildPlaybackFractions} from '../../../lib/utils/playback-pacing.js';
import {GuiEventTimeline, GuiEventTimelineEntry} from './gui-state.model';
import {
	buildTheatrePlan,
	canPlayTimeline,
	cursorAt,
	nextSpeed,
	playbackPosition,
	seekTimeFor,
	THEATRE_LEAD_IN,
	theatreDurationMs,
} from './theatre';

const entry = (
	id: string,
	t: number,
	issue: string | null = null,
): GuiEventTimelineEntry => ({
	id,
	t,
	action: 'issue:create',
	label: `event ${id}`,
	actor: null,
	tag: null,
	assignee: null,
	issue,
});

const timeline = (events: GuiEventTimelineEntry[]): GuiEventTimeline => ({
	bucketMs: 1000,
	buckets: [],
	events,
	earliest: 0,
	latest: 10_000,
});

describe('buildTheatrePlan', () => {
	it('plays the window in clock order, whatever order the log listed it in', () => {
		const plan = buildTheatrePlan(
			timeline([entry('b', 300), entry('a', 100), entry('c', 200)]),
		);

		expect(plan?.events.map(event => event.id)).toEqual(['a', 'c', 'b']);
	});

	it('opens a tick before the first event and closes on the last', () => {
		const plan = buildTheatrePlan(timeline([entry('a', 100), entry('b', 900)]));

		expect(plan?.startTime).toBe(99);
		expect(plan?.endTime).toBe(900);
	});

	it('carries the ticket each event happened to, for the board to flash', () => {
		const plan = buildTheatrePlan(
			timeline([entry('a', 100, 'issue-1'), entry('b', 200, null)]),
		);

		expect(plan?.events.map(event => event.issue)).toEqual(['issue-1', null]);
	});

	it('refuses a window too thin to be a movie', () => {
		expect(buildTheatrePlan(timeline([entry('a', 100)]))).toBeNull();
		expect(buildTheatrePlan(timeline([]))).toBeNull();
	});
});

describe('canPlayTimeline', () => {
	it('is false with no timeline, and for a window the server sent as buckets alone', () => {
		expect(canPlayTimeline(null)).toBe(false);
		expect(canPlayTimeline(timeline([]))).toBe(false);
	});

	it('is true once the window holds a stretch to play', () => {
		expect(canPlayTimeline(timeline([entry('a', 1), entry('b', 2)]))).toBe(
			true,
		);
	});
});

describe('buildPlaybackFractions', () => {
	it('runs from the first event to a full bar on the last', () => {
		const fractions = buildPlaybackFractions([0, 1000, 2000]);

		expect(fractions[0]).toBe(0);
		expect(fractions[2]).toBe(1);
	});

	// The point of the weighting, in the terms the util itself puts it: one
	// month-long gap costs far less playback time than thirty day-long ones. A
	// quiet stretch fast-forwards; a busy one keeps its spacing.
	it('gives a busy month far more of the movie than a silent one of equal length', () => {
		const dayMs = 24 * 60 * 60 * 1000;

		// A month of one event a day, then a month of silence, then one event.
		// The two months are the same length of wall clock.
		const times = Array.from({length: 31}, (_, index) => index * dayMs).concat(
			60 * dayMs,
		);
		const fractions = buildPlaybackFractions(times);

		const busyShare = fractions[30]! - fractions[0]!;
		const silentShare = fractions[31]! - fractions[30]!;

		expect(busyShare).toBeGreaterThan(silentShare * 4);
	});

	it('spaces events evenly when every timestamp is identical', () => {
		expect(buildPlaybackFractions([5, 5, 5, 5])).toEqual([0.25, 0.5, 0.75, 1]);
	});
});

describe('cursorAt', () => {
	const fractions = [0, 0.5, 1];

	it('is -1 before the first event has landed', () => {
		expect(cursorAt(fractions, -0.1)).toBe(-1);
	});

	it('lands an event exactly on its own position', () => {
		expect(cursorAt(fractions, 0)).toBe(0);
		expect(cursorAt(fractions, 0.5)).toBe(1);
		expect(cursorAt(fractions, 1)).toBe(2);
	});

	it('holds the last event it passed between two positions', () => {
		expect(cursorAt(fractions, 0.49)).toBe(0);
		expect(cursorAt(fractions, 0.99)).toBe(1);
	});
});

describe('playbackPosition', () => {
	// The first event sits at fraction 0, so without the opening beat it would
	// land on the clock's own frame zero and the movie would start one edit in.
	it('is before the first event for as long as the opening beat runs', () => {
		expect(playbackPosition(0)).toBeLessThan(0);
		expect(playbackPosition(THEATRE_LEAD_IN / 2)).toBeLessThan(0);
		expect(cursorAt([0, 0.5, 1], playbackPosition(0))).toBe(-1);
	});

	it('reaches the first event as the beat ends, and the last at the end', () => {
		expect(playbackPosition(THEATRE_LEAD_IN)).toBeCloseTo(0);
		expect(playbackPosition(1)).toBeCloseTo(1);
	});
});

describe('seekTimeFor', () => {
	const plan = buildTheatrePlan(timeline([entry('a', 100), entry('b', 200)]))!;

	it('opens on the board before any of it happened', () => {
		expect(seekTimeFor(plan, -1)).toBe(99);
	});

	// The checkout cut is exclusive, so the moment asked for has to be past the
	// event or the state it produced is the one left out.
	it('asks for the moment just past the event, so its own change is in', () => {
		expect(seekTimeFor(plan, 0)).toBe(101);
		expect(seekTimeFor(plan, 1)).toBe(201);
	});
});

describe('theatreDurationMs', () => {
	it('does not pad a handful of events out, nor let a long history run away', () => {
		expect(theatreDurationMs(1)).toBe(6_000);
		expect(theatreDurationMs(100_000)).toBe(45_000);
	});

	it('scales with the number of events in between', () => {
		expect(theatreDurationMs(50)).toBeGreaterThan(theatreDurationMs(20));
	});
});

describe('nextSpeed', () => {
	it('cycles and wraps', () => {
		expect(nextSpeed(0.5)).toBe(1);
		expect(nextSpeed(1)).toBe(2);
		expect(nextSpeed(2)).toBe(4);
		expect(nextSpeed(4)).toBe(0.5);
	});
});
