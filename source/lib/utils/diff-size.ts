// Whether a file's diff is too big to be worth rendering unasked.
//
// The GUI receives both sides as whole blobs and diffs and syntax-highlights
// them in the browser, so the cost scales with how much text there is rather
// than with how much of it changed. A lockfile is the usual offender: a
// one-line real change buried in tens of thousands of lines that all have to
// be walked to prove it.

// Structural rather than the GUI's own GuiCommitDiffFile: this lives outside
// source/gui so the Node-side build and its tests can reach it too.
export type DiffSides = {before: string; after: string};

// Two limits because either alone has a blind spot: a minified bundle is one
// 2MB line, and a long file of short lines stays under any byte cap worth
// setting. Sized off this repo — its longest hand-written file is ~2k lines
// and ~70KB, its package-lock ~10.5k lines and ~330KB.
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

// Measured per side rather than over the pair: a file is big or it is not, and
// summing would call a modification of a 110KB file large while an addition of
// the same file is not.
export const diffLineCount = (file: DiffSides): number =>
	Math.max(lineCount(file.before), lineCount(file.after));

// Deliberately a heuristic on the raw sides. The real diff is the expensive
// thing, so computing it to decide whether to compute it defeats the point.
export const isLargeDiff = (file: DiffSides): boolean =>
	Math.max(file.before.length, file.after.length) > LARGE_DIFF_CHARS ||
	diffLineCount(file) > LARGE_DIFF_LINES;

// How much source a view may open unasked, across every file it shows.
//
// The per-file limits above have a blind spot of their own: a commit of a
// hundred ordinary files passes all of them and is still a hundred files handed
// to the highlighter at once. One such commit in this repo's history — 118
// files, 1.7 million characters, no single file large — took 5.6 s to paint
// against 1.5 s for its first forty.
//
// Set above LARGE_DIFF_CHARS so a commit that fits inside one file's allowance
// is never touched, which is nearly all of them.
export const DIFF_BUDGET_CHARS = 300_000;

// How much of a file the budget is charged for. The rendered side is the
// larger one — a deletion draws the old text, an addition the new.
const diffCharCount = (file: DiffSides): number =>
	Math.max(file.before.length, file.after.length);

/**
 * Which files a view opens without being asked: those under the per-file
 * limits, in order, until the shared budget runs out.
 *
 * Returned as a parallel array rather than a predicate, because the answer for
 * one file depends on the files before it — a caller asking per file would get
 * a different answer depending on when it asked.
 */
export const openableByDefault = (
	files: readonly DiffSides[],
): readonly boolean[] => {
	let spent = 0;

	return files.map(file => {
		if (isLargeDiff(file)) return false;

		// Charged only for what is opened, so a file the budget refuses does not
		// also spend it — otherwise one big file near the front would shut
		// everything behind it.
		if (spent >= DIFF_BUDGET_CHARS) return false;

		spent += diffCharCount(file);

		return true;
	});
};
