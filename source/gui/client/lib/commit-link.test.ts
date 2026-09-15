import {describe, expect, it} from 'vitest';
import {keptCommits} from './commit-link';
import {GuiCommitEntry} from './gui-state.model';

const commit = (sha: string, subject: string): GuiCommitEntry => ({
	sha,
	time: 0,
	author: 'jo',
	subject,
	linesChanged: 1,
	insertions: 1,
	deletions: 0,
});

const commits = [
	commit('a', 'ABC1234 fix the thing'),
	commit('b', 'plain housekeeping'),
	commit('c', 'XYZ9876 the other ticket'),
	commit('d', 'ZZZ0000 a ref the board does not know'),
];

const issueIdByRef = new Map([
	['ABC1234', 'issue-a'],
	['XYZ9876', 'issue-c'],
]);

describe('keptCommits', () => {
	it('keeps every commit, as the same list, while not narrowed', () => {
		expect(keptCommits(commits, false, issueIdByRef, new Set(['x']))).toBe(
			commits,
		);
	});

	it('keeps only commits leading with the ref of a ticket the board knows', () => {
		expect(
			keptCommits(commits, true, issueIdByRef, null).map(c => c.sha),
		).toEqual(['a', 'c']);
	});

	// The board down to some tickets narrows the commits the same way it
	// narrows the events: to the ones linked to those tickets.
	it('narrows further to the tickets the board keeps', () => {
		expect(
			keptCommits(commits, true, issueIdByRef, new Set(['issue-c'])).map(
				c => c.sha,
			),
		).toEqual(['c']);
		expect(keptCommits(commits, true, issueIdByRef, new Set())).toEqual([]);
	});
});
