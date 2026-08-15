/**
 * Folded rather than spread: `Math.min(...values)` throws once the array grows
 * past the engine's argument limit, so it fails outright on unbounded input
 * instead of degrading. `seed` also keeps the empty case off ±Infinity.
 */
export const minOf = (values: readonly number[], seed: number): number =>
	values.reduce((min, value) => (value < min ? value : min), seed);

export const maxOf = (values: readonly number[], seed: number): number =>
	values.reduce((max, value) => (value > max ? value : max), seed);
