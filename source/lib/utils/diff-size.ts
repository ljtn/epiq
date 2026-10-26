// Whether a file's diff is too big to render unasked; the GUI diffs and
// highlights whole blobs, so cost scales with total text.

// Structural so Node-side code can use it. `isBinary` matters: both sides
// arrive empty, which would otherwise look smallest.
export type DiffSides = {before: string; after: string; isBinary?: boolean};

// Lines and bytes both: a minified bundle is one huge line, and a long file of
// short lines passes any byte cap.
export const LARGE_DIFF_LINES = 4_000;
export const LARGE_DIFF_CHARS = 200_000;

// indexOf rather than split: this runs per file on every render, and splitting
// a lockfile allocates an array the length of the file to count it.
export const lineCount = (text: string): number => {
	if (text === '') return 0;

	let lines = 1;

	for (
		let index = text.indexOf('\n');
		index !== -1;
		index = text.indexOf('\n', index + 1)
	) {
		lines++;
	}

	return lines;
};

// Per side, not summed, so a modify and an add of one file agree.
export const diffLineCount = (file: DiffSides): number =>
	Math.max(lineCount(file.before), lineCount(file.after));

// Deliberately a heuristic on the raw sides. The real diff is the expensive
// thing, so computing it to decide whether to compute it defeats the point.
export const isLargeDiff = (file: DiffSides): boolean =>
	Math.max(file.before.length, file.after.length) > LARGE_DIFF_CHARS ||
	diffLineCount(file) > LARGE_DIFF_LINES;

// How much source a view may open unasked across all its files, since each
// file mounts its own DOM. Well above one file's allowance.
export const DIFF_BUDGET_CHARS = 500_000;

// Both sides summed, unlike `isLargeDiff`: this is a cost, and a diff reads both.
const diffCharCount = (file: DiffSides): number =>
	file.before.length + file.after.length;

/** Whether this file has a diff at all; what "Expand all" opens. */
export const hasDiffToShow = (file: DiffSides): boolean => !file.isBinary;

/**
 * Which files open unasked: those under the per-file limits, in order, until
 * the shared budget runs out. Each answer depends on the ones before.
 */
export const openableByDefault = (
	files: readonly DiffSides[],
): readonly boolean[] => {
	let spent = 0;

	return files.map(file => {
		// Binary: nothing to draw.
		if (!hasDiffToShow(file)) return false;

		if (isLargeDiff(file)) return false;

		// Only opened files spend the budget; the one crossing the line still opens.
		if (spent >= DIFF_BUDGET_CHARS) return false;

		spent += diffCharCount(file);

		return true;
	});
};

/**
 * The same answer as paths. Pass only candidate files, so a reviewed one
 * doesn't spend the budget.
 */
export const pathsOpenByDefault = <T extends DiffSides & {path: string}>(
	files: readonly T[],
): string[] => {
	const open = openableByDefault(files);

	return files.filter((_, index) => open[index]).map(file => file.path);
};
