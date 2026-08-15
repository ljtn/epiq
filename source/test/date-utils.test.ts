import {describe, expect, it} from 'vitest';
import {
	formatDateTime,
	formatTimeOfDay,
	isSameDay,
} from '../lib/utils/date.utils.js';

describe('formatDateTime', () => {
	it('zero-pads every field but the year', () => {
		expect(formatDateTime(new Date(2026, 0, 5, 9, 7))).toBe('2026-01-05 09:07');
	});

	it('renders midnight as 00:00 rather than 24:00', () => {
		expect(formatDateTime(new Date(2026, 7, 16, 0, 0))).toBe(
			'2026-08-16 00:00',
		);
	});
});

describe('formatTimeOfDay', () => {
	it('drops the date half', () => {
		expect(formatTimeOfDay(new Date(2026, 7, 16, 23, 59))).toBe('23:59');
	});
});

describe('isSameDay', () => {
	it('is true for two moments inside one local day', () => {
		expect(
			isSameDay(new Date(2026, 7, 16, 0, 0), new Date(2026, 7, 16, 23, 59)),
		).toBe(true);
	});

	it('is false across midnight', () => {
		expect(
			isSameDay(new Date(2026, 7, 16, 23, 59), new Date(2026, 7, 17, 0, 0)),
		).toBe(false);
	});

	it('is false for the same day number in a different month or year', () => {
		expect(isSameDay(new Date(2026, 7, 16), new Date(2026, 8, 16))).toBe(false);
		expect(isSameDay(new Date(2026, 7, 16), new Date(2025, 7, 16))).toBe(false);
	});
});
