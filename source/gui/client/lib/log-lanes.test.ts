import {describe, expect, it} from 'vitest';
import {LogEntry} from './event-log';
import {laneIndexByName, laneIndexOf, logLanes} from './log-lanes';

const line = (
	id: string,
	actor: {name: string; color: string} | null,
): LogEntry => ({
	id,
	t: Number(id),
	label: `line ${id}`,
	color: '#fff',
	actor,
	diff: null,
	issue: null,
	action: null,
	sha: null,
});

const jo = {name: 'jo', color: '#a1a'};
const will = {name: 'claude/william', color: '#1aa'};

describe('logLanes', () => {
	it('is one lane per actor, in the order they first appear', () => {
		expect(logLanes([line('1', will), line('2', jo), line('3', will)])).toEqual(
			[will, jo],
		);
	});

	it('has no lane for a slice nobody signed', () => {
		expect(logLanes([line('1', null), line('2', null)])).toEqual([]);
	});

	it('keeps each actor\u2019s colour, so a heading reads as they do elsewhere', () => {
		expect(logLanes([line('1', jo)])[0]?.color).toBe(jo.color);
	});
});

describe('laneIndexOf', () => {
	const lanes = logLanes([line('1', will), line('2', jo)]);
	const indexes = laneIndexByName(lanes);

	it('puts a line in its actor\u2019s lane', () => {
		expect(laneIndexOf(line('3', jo), indexes)).toBe(1);
		expect(laneIndexOf(line('4', will), indexes)).toBe(0);
	});

	// It spans them all rather than landing in somebody else's.
	it('gives an unsigned line no lane', () => {
		expect(laneIndexOf(line('5', null), indexes)).toBeNull();
	});

	// A slice can move under the lanes: a name that has scrolled out of it has
	// no column left to sit in.
	it('gives a line no lane when its actor has none', () => {
		expect(laneIndexOf(line('6', {name: 'gone', color: '#000'}), indexes)).toBe(
			null,
		);
	});
});
