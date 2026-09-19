import {describe, expect, it} from 'vitest';
import {keptCommits} from './commit-link';
import {GuiCommitEntry} from './gui-state.model';

const commit = (sha: string, subject: string): GuiCommitEntry => ({
	sha,
	time: 0,
	author: 'jo',
	authorEmail: 'someone@example.com',
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
	it('keeps every commit, as the same list, while nothing narrows them', () => {
		expect(keptCommits(commits, false, false, issueIdByRef, null)).toBe(
			commits,
		);
	});

	// A text filter leaves several tickets on screen and says nothing about
	// commits, so with the select off it must not quietly take the repository's
	// commits off the chart.
	it('keeps every commit under a text filter alone', () => {
		expect(
			keptCommits(commits, false, false, issueIdByRef, new Set(['issue-a'])),
		).toBe(commits);
	});

	// The ticket funnel is the narrowing that does speak for the commits: the
	// board is down to one ticket, so the picture is that ticket's.
	it('narrows to the open ticket with the select off', () => {
		expect(
			keptCommits(commits, false, true, issueIdByRef, new Set(['issue-a'])).map(
				c => c.sha,
			),
		).toEqual(['a']);
	});

	it('keeps only commits leading with the ref of a ticket the board knows', () => {
		expect(
			keptCommits(commits, true, false, issueIdByRef, null).map(c => c.sha),
		).toEqual(['a', 'c']);
	});

	// The board down to some tickets narrows the commits the same way it
	// narrows the events: to the ones linked to those tickets.
	it('narrows further to the tickets the board keeps', () => {
		expect(
			keptCommits(commits, true, false, issueIdByRef, new Set(['issue-c'])).map(
				c => c.sha,
			),
		).toEqual(['c']);
		expect(keptCommits(commits, true, false, issueIdByRef, new Set())).toEqual(
			[],
		);
	});
});
