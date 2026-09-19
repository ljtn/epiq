import {describe, expect, it} from 'vitest';
import {LogEntry} from './event-log';
import {
	laneCapacity,
	laneIndexByName,
	laneIndexOf,
	logLanes,
	MIN_LANE_WIDTH_PX,
} from './log-lanes';

const line = (id: string, actor: {name: string} | null): LogEntry => ({
	id,
	t: Number(id),
	label: `line ${id}`,
	color: '#fff',
	actor,
	diff: null,
	issue: null,
	target: null,
	action: null,
	sha: null,
});

const jo = {name: 'jo'};
const will = {name: 'claude/william'};

const named = (name: string) => ({name});

describe('logLanes', () => {
	// By name rather than by first appearance: the slice slides as lines land,
	// and an order that followed it would move every lane sideways when the
	// oldest line drops off the top.
	it('is one lane per actor, in name order', () => {
		expect(logLanes([line('1', jo), line('2', will), line('3', jo)])).toEqual([
			will,
			jo,
		]);
	});

	it('has no lane for a slice nobody signed', () => {
		expect(logLanes([line('1', null), line('2', null)])).toEqual([]);
	});

	// Past what the pane holds, the busiest keep their own lane and the rest
	// share the last one rather than every lane becoming too narrow to read.
	it('folds the quietest actors into a shared last lane', () => {
		const lanes = logLanes(
			[
				line('1', named('a')),
				line('2', named('a')),
				line('3', named('b')),
				line('4', named('b')),
				line('5', named('c')),
				line('6', named('d')),
			],
			3,
		);

		expect(lanes.map(lane => lane.name)).toEqual(['a', 'b', '+2 more']);
		expect(lanes[2]?.others).toBe(true);
	});

	it('leaves the lanes alone when they all fit', () => {
		expect(logLanes([line('1', jo), line('2', will)], 2)).toEqual([will, jo]);
	});
});

describe('laneCapacity', () => {
	it('grows a lane at a time as the pane widens', () => {
		expect(laneCapacity(1000)).toBeGreaterThan(laneCapacity(500));
	});

	it('never drops below one, however narrow the pane', () => {
		expect(laneCapacity(0)).toBe(1);
		expect(laneCapacity(MIN_LANE_WIDTH_PX)).toBe(1);
	});
});

describe('laneIndexOf', () => {
	const lanes = logLanes([line('1', will), line('2', jo)]);
	const indexes = laneIndexByName(lanes);

	it('puts a line in its actor’s lane', () => {
		expect(laneIndexOf(line('3', jo), lanes, indexes)).toBe(1);
		expect(laneIndexOf(line('4', will), lanes, indexes)).toBe(0);
	});

	// It spans them all rather than landing in somebody else's.
	it('gives an unsigned line no lane', () => {
		expect(laneIndexOf(line('5', null), lanes, indexes)).toBeNull();
	});

	// A slice can move under the lanes: a name that has scrolled out of it has
	// no column left to sit in.
	it('gives a line no lane when its actor has none', () => {
		expect(laneIndexOf(line('6', named('gone')), lanes, indexes)).toBeNull();
	});

	it('puts an actor with no lane of their own in the shared one', () => {
		const folded = logLanes(
			[
				line('1', named('a')),
				line('2', named('a')),
				line('3', named('b')),
				line('4', named('c')),
			],
			2,
		);

		expect(
			laneIndexOf(line('5', named('c')), folded, laneIndexByName(folded)),
		).toBe(folded.length - 1);
	});
});
