import {describe, expect, test} from 'vitest';
import {dateOfDay, dayOf, monthGrid, stepDay} from './calendar-day';

describe('calendar day', () => {
	test('a local date is written as its own day, not as UTC sees it', () => {
		expect(dayOf(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
		expect(dayOf(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
	});

	test('a day reads back as its local midnight', () => {
		const date = dateOfDay('2026-02-28');
		expect(date?.getFullYear()).toBe(2026);
		expect(date?.getMonth()).toBe(1);
		expect(date?.getDate()).toBe(28);
		expect(date?.getHours()).toBe(0);
	});

	test('anything not a real day is refused', () => {
		for (const day of ['202600-12-01', '2026-02-30', '2026-13-01', '', 'all'])
			expect(dateOfDay(day)).toBeNull();
	});
});

describe('month grid', () => {
	test('six Monday-first weeks around the month', () => {
		// October 2026 starts on a Thursday.
		const grid = monthGrid(new Date(2026, 9, 15)).map(dayOf);
		expect(grid).toHaveLength(42);
		expect(grid[0]).toBe('2026-09-28');
		expect(grid[3]).toBe('2026-10-01');
		expect(grid[41]).toBe('2026-11-08');
	});

	test('a month starting on a Monday starts the grid', () => {
		expect(dayOf(monthGrid(new Date(2026, 5, 1))[0]!)).toBe('2026-06-01');
	});

	test('across a daylight saving change every day appears once', () => {
		const grid = monthGrid(new Date(2026, 2, 1)).map(dayOf);
		expect(new Set(grid).size).toBe(42);
	});
});

describe('stepping the focused day', () => {
	const from = (day: string, key: string) =>
		dayOf(stepDay(dateOfDay(day)!, key)!);

	test('arrows move a day or a week, across months', () => {
		expect(from('2026-10-01', 'ArrowLeft')).toBe('2026-09-30');
		expect(from('2026-10-31', 'ArrowRight')).toBe('2026-11-01');
		expect(from('2026-10-03', 'ArrowUp')).toBe('2026-09-26');
		expect(from('2026-10-28', 'ArrowDown')).toBe('2026-11-04');
	});

	test('Home and End keep to the Monday-first week', () => {
		// 2026-10-21 is a Wednesday.
		expect(from('2026-10-21', 'Home')).toBe('2026-10-19');
		expect(from('2026-10-21', 'End')).toBe('2026-10-25');
	});

	test('a page is a month, held to its last day', () => {
		expect(from('2026-03-31', 'PageUp')).toBe('2026-02-28');
		expect(from('2026-01-31', 'PageDown')).toBe('2026-02-28');
	});

	test('any other key is no step', () => {
		expect(stepDay(new Date(2026, 9, 21), 'Enter')).toBeNull();
	});
});
