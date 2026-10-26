/**
 * Folded, not spread: `Math.min(...values)` throws past the argument limit.
 * `seed` keeps the empty case off ±Infinity.
 */
export const minOf = (values: readonly number[], seed: number): number =>
	values.reduce((min, value) => (value < min ? value : min), seed);

export const maxOf = (values: readonly number[], seed: number): number =>
	values.reduce((max, value) => (value > max ? value : max), seed);
