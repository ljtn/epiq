export function clamp(n: number, min: number, max: number) {
	return Math.max(min, Math.min(max, n));
}

/** The middle of an already-sorted list, averaging the middle pair of an even one. */
export const medianOfSorted = (sorted: readonly number[]): number | null => {
	if (sorted.length === 0) return null;

	const middle = Math.floor(sorted.length / 2);

	return sorted.length % 2 === 0
		? (sorted[middle - 1]! + sorted[middle]!) / 2
		: sorted[middle]!;
};
