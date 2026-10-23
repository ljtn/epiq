import {describe, expect, it} from 'vitest';
import {toDiffFileInput} from './diff-file-input';

const file = (before: string, after: string) => ({
	path: 'source/lib/stats/board-overview.ts',
	before,
	after,
	insertions: 0,
	deletions: 0,
});

const keys = (before: string, after: string) => {
	const input = toDiffFileInput(file(before, after));

	return [input.oldFile?.cacheKey, input.newFile?.cacheKey];
};

describe('toDiffFileInput', () => {
	// The worker pool keeps highlighted lines under this key; shared by two
	// commits' versions of one path, the second drew over the first's lines.
	it('keys one path differently for different contents', () => {
		const [oldA, newA] = keys('a\n', 'a\nb\n');
		const [oldB, newB] = keys('x\n', 'x\ny\n');

		expect(new Set([oldA, newA, oldB, newB]).size).toBe(4);
	});

	it('keys the same contents alike, so a redraw reuses its highlight', () => {
		expect(keys('a\n', 'b\n')).toEqual(keys('a\n', 'b\n'));
	});

	it('leaves out the side a new or deleted file does not have', () => {
		expect(toDiffFileInput(file('', 'a\n')).oldFile).toBeNull();
		expect(toDiffFileInput(file('a\n', '')).newFile).toBeNull();
	});
});
