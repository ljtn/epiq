import {describe, expect, test} from 'vitest';
import {diffFill} from './diff-stat.style';

// One fixed scale for every ticket, so a huge change elsewhere never shrinks
// a small one.
describe('a sized diff bar', () => {
	test('fills by the size of the change, logarithmically', () => {
		expect(diffFill(1)).toBeCloseTo(0.1, 1);
		expect(diffFill(10)).toBeCloseTo(0.35, 1);
		expect(diffFill(100)).toBeCloseTo(0.67, 1);
	});

	test('is full from a thousand lines and never past it', () => {
		expect(diffFill(1000)).toBe(1);
		expect(diffFill(50_000)).toBe(1);
	});

	test('a bigger change never fills less', () => {
		const sizes = [1, 3, 9, 40, 250, 999, 1000, 4000];
		const fills = sizes.map(diffFill);
		expect(fills).toEqual([...fills].sort((a, b) => a - b));
	});
});
