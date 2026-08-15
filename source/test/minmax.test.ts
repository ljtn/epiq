import {describe, expect, it} from 'vitest';
import {maxOf, minOf} from '../lib/utils/minmax.js';

// Above the engine's argument cap. Realistic: one entry per commit, or per
// event in the whole log.
const OVER_SPREAD_LIMIT = 200_000;

describe('minOf / maxOf', () => {
	it('finds the smallest and largest value', () => {
		expect(minOf([5, 2, 9], Infinity)).toBe(2);
		expect(maxOf([5, 2, 9], -Infinity)).toBe(9);
	});

	it('returns the seed for an empty array', () => {
		expect(minOf([], 42)).toBe(42);
		expect(maxOf([], 42)).toBe(42);
	});

	it('lets the seed win when it is more extreme', () => {
		expect(minOf([5, 2, 9], 1)).toBe(1);
		expect(maxOf([5, 2, 9], 100)).toBe(100);
	});

	it('handles negatives and duplicates', () => {
		expect(minOf([-1, -1, 3], Infinity)).toBe(-1);
		expect(maxOf([-5, -5, -9], -Infinity)).toBe(-5);
	});

	// Spreading past the cap throws rather than degrading.
	it('handles an array larger than the engine can spread', () => {
		const values = Array.from({length: OVER_SPREAD_LIMIT}, (_, i) => i);

		expect(() => Math.min(...values)).toThrow(RangeError);

		expect(minOf(values, Infinity)).toBe(0);
		expect(maxOf(values, -Infinity)).toBe(OVER_SPREAD_LIMIT - 1);
	});
});
