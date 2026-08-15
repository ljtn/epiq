/**
 * Smallest / largest of `values`, folded in rather than spread.
 *
 * `Math.min(...values)` passes one argument per element, and engines cap how
 * many arguments a call can take (v8 throws `RangeError: Maximum call stack
 * size exceeded` somewhere around 100k). So a spread over an unbounded array —
 * every event in the log, every commit in the repository — does not degrade as
 * it grows, it starts throwing.
 *
 * `seed` is the starting value, which also makes the empty case explicit
 * instead of silently yielding ±Infinity.
 *
 * Pure and dependency-free so the GUI client can import it too.
 */
export const minOf = (values: readonly number[], seed: number): number =>
	values.reduce((min, value) => (value < min ? value : min), seed);

export const maxOf = (values: readonly number[], seed: number): number =>
	values.reduce((max, value) => (value > max ? value : max), seed);
