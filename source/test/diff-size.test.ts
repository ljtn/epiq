import {describe, expect, it} from 'vitest';
import {
	DIFF_BUDGET_CHARS,
	LARGE_DIFF_CHARS,
	LARGE_DIFF_LINES,
	diffLineCount,
	isLargeDiff,
	lineCount,
	openableByDefault,
} from '../lib/utils/diff-size.js';

const file = (before: string, after: string) => ({
	path: 'package-lock.json',
	before,
	after,
});

const lines = (count: number, text = 'x') =>
	Array.from({length: count}, () => text).join('\n');

describe('lineCount', () => {
	it('counts an empty file as no lines rather than one', () => {
		expect(lineCount('')).toBe(0);
	});

	it('counts a file with no trailing newline', () => {
		expect(lineCount('a\nb\nc')).toBe(3);
	});

	// The common shape on disk, and the one an off-by-one would land on.
	it('counts the empty last line a trailing newline leaves', () => {
		expect(lineCount('a\nb\nc\n')).toBe(4);
	});
});

describe('diffLineCount', () => {
	// The label on the badge and the notice reads off this, so a modification
	// must not report the smaller side.
	it('reports the longer of the two sides', () => {
		expect(diffLineCount(file(lines(10), lines(3)))).toBe(10);
		expect(diffLineCount(file(lines(3), lines(10)))).toBe(10);
	});
});

describe('isLargeDiff', () => {
	it('leaves an ordinary source file alone', () => {
		expect(isLargeDiff(file(lines(500), lines(520)))).toBe(false);
	});

	it('catches a file past the line limit', () => {
		expect(isLargeDiff(file('', lines(LARGE_DIFF_LINES + 1)))).toBe(true);
	});

	// A minified bundle is one enormous line, so a line count alone would wave
	// it through.
	it('catches a single line past the character limit', () => {
		expect(isLargeDiff(file('', 'x'.repeat(LARGE_DIFF_CHARS + 1)))).toBe(true);
	});

	// Measured per side, not summed: two ordinary sides of a modification must
	// not add up to "large".
	it('does not add the two sides together', () => {
		const side = 'x'.repeat(Math.floor(LARGE_DIFF_CHARS * 0.6));

		expect(isLargeDiff(file(side, side))).toBe(false);
	});

	// The reported case: a lockfile is large on the side it was deleted from
	// as much as on the side it was added to.
	it('catches a large file on either side', () => {
		const big = lines(LARGE_DIFF_LINES + 1);

		expect(isLargeDiff(file(big, ''))).toBe(true);
		expect(isLargeDiff(file('', big))).toBe(true);
	});

	it('leaves a file exactly at the limits alone', () => {
		expect(isLargeDiff(file('', lines(LARGE_DIFF_LINES)))).toBe(false);
		expect(isLargeDiff(file('', 'x'.repeat(LARGE_DIFF_CHARS)))).toBe(false);
	});
});

describe('openableByDefault', () => {
	const sized = (chars: number, path: string) => ({
		path,
		before: '',
		after: 'x'.repeat(chars),
	});

	// The ordinary commit, which is nearly all of them: nothing changes.
	it('opens every file of a commit that fits inside the budget', () => {
		const files = [sized(1_000, 'a.ts'), sized(2_000, 'b.ts')];

		expect(openableByDefault(files)).toEqual([true, true]);
	});

	// The reported case: a hundred ordinary files is as much work for the
	// highlighter as one enormous one, and no per-file limit sees it.
	it('shuts the files past the budget, though each one is small', () => {
		const quarter = Math.ceil(DIFF_BUDGET_CHARS / 4);
		const files = Array.from({length: 10}, (_, index) =>
			sized(quarter, `f${index}.ts`),
		);

		const open = openableByDefault(files);

		// Four fill the budget; the rest are asked to spend past it.
		expect(open.slice(0, 4)).toEqual([true, true, true, true]);
		expect(open.slice(4).some(Boolean)).toBe(false);
	});

	// A file the per-file limit already refuses must not also spend the budget,
	// or one lockfile near the front shuts everything behind it.
	it('does not charge the budget for a file it refuses anyway', () => {
		const files = [
			sized(LARGE_DIFF_CHARS + 1, 'package-lock.json'),
			sized(1_000, 'a.ts'),
			sized(1_000, 'b.ts'),
		];

		expect(openableByDefault(files)).toEqual([false, true, true]);
	});

	it('still refuses a single file past the per-file limit', () => {
		expect(openableByDefault([sized(LARGE_DIFF_CHARS + 1, 'big.ts')])).toEqual([
			false,
		]);
	});

	it('has an answer for every file it was given, in order', () => {
		const files = Array.from({length: 40}, (_, index) =>
			sized(20_000, `f${index}.ts`),
		);

		expect(openableByDefault(files)).toHaveLength(40);
	});
});
