// Whether a file's diff is too big to be worth rendering unasked.
//
// The GUI receives both sides as whole blobs and diffs and syntax-highlights
// them in the browser, so the cost scales with how much text there is rather
// than with how much of it changed. A lockfile is the usual offender: a
// one-line real change buried in tens of thousands of lines that all have to
// be walked to prove it.

// Structural rather than the GUI's own GuiCommitDiffFile: this lives outside
// source/gui so the Node-side build and its tests can reach it too.
//
// `isBinary` is git's own answer, and both sides of such a file arrive empty —
// so without it the limits below would call an image the smallest file in the
// commit and open it first.
export type DiffSides = {before: string; after: string; isBinary?: boolean};

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
// Most of that gap is gone: the highlighter runs in a worker pool now (see
// `gui/client/lib/diffs-worker-pool`) and the same commit paints in under a
// second either way. What is left is the part no pool can move — a component
// tree and its DOM per file, on the one thread that draws — so this stays as
// the only bound on how many of those mount unasked.
//
// Comfortably above a single file's allowance, so a commit that would fit
// inside one large file is never touched — which is nearly all of them.
export const DIFF_BUDGET_CHARS = 500_000;

// Both sides, unlike `isLargeDiff` above, which takes the larger of the two.
// They answer different questions: that one asks whether *this file* is
// outsized, where summing would call a modification of a 110KB file large
// while an addition of the same file is not. This one is a cost, and a diff
// costs what it has to read — both revisions, whichever way it is laid out.
const diffCharCount = (file: DiffSides): number =>
	file.before.length + file.after.length;

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
		// Nothing to open: a binary file has no diff to draw, and it has no size
		// either, so left to the limits below it would be the cheapest file in
		// the commit and go first.
		if (file.isBinary) return false;

		if (isLargeDiff(file)) return false;

		// Charged only for what is opened, so a file the budget refuses does not
		// also spend it — otherwise one big file near the front would shut
		// everything behind it. The file that crosses the line is opened rather
		// than shut, so the budget is a floor on what a reader gets, not a cap
		// on what they are shown.
		if (spent >= DIFF_BUDGET_CHARS) return false;

		spent += diffCharCount(file);

		return true;
	});
};

/**
 * The same answer as paths, for the views that track what is open by path
 * rather than by position.
 *
 * Hand it the files that are candidates at all — one that is shut for another
 * reason, a file already reviewed, must not spend the budget on the way.
 */
export const pathsOpenByDefault = <T extends DiffSides & {path: string}>(
	files: readonly T[],
): string[] => {
	const open = openableByDefault(files);

	return files.filter((_, index) => open[index]).map(file => file.path);
};
