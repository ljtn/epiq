import {describe, expect, it} from 'vitest';
import {statGrid, statsAcross, statValueSize} from './issue-stats.style';

const columns = (count: number, across: number) =>
	String(statGrid(count, across).gridTemplateColumns).match(
		/repeat\((\d+)/,
	)![1];

describe('statGrid', () => {
	it('puts every stat on one row where they fit', () => {
		expect(columns(3, 4)).toBe('3');
		expect(columns(4, 4)).toBe('4');
	});

	// One of four alone on a second row reads as a mistake.
	it('goes two by two, not three and one', () => {
		expect(columns(4, 3)).toBe('2');
	});

	it('fills what fits otherwise', () => {
		expect(columns(3, 2)).toBe('2');
		expect(columns(4, 1)).toBe('1');
	});
});

describe('statsAcross', () => {
	it('counts whole squares and their gaps', () => {
		expect(statsAcross(116)).toBe(1);
		expect(statsAcross(4 * 116 + 3 * 16)).toBe(4);
		expect(statsAcross(4 * 116 + 3 * 16 - 1)).toBe(3);
		expect(statsAcross(0)).toBe(1);
	});
});

describe('statValueSize', () => {
	it('keeps a short figure at full size and shrinks a long one to fit', () => {
		expect(statValueSize('47%')).toBe(38);
		expect(statValueSize('1000')).toBe(38);
		expect(statValueSize('12345') * 0.62 * 5).toBeLessThanOrEqual(100);
		expect(statValueSize('1234567') * 0.62 * 7).toBeLessThanOrEqual(100);
	});
});
