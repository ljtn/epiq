import {describe, expect, it} from 'vitest';
import {issueIdByRefFor, keptCommits} from './commit-link';
import {GuiBoard, GuiCommitEntry, GuiIssue} from './gui-state.model';

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

const issue = (
	ref: string,
	id: string,
	closedFrom: string | null = null,
): GuiIssue => ({
	isClosed: closedFrom !== null,
	id,
	ref,
	title: ref,
	description: '',
	createdAt: 0,
	enteredLaneAt: 0,
	readonly: false,
	tags: [],
	assignees: [],
	closedFromBoardId: closedFrom,
});

const board = (id: string, issues: GuiIssue[]): GuiBoard => ({
	id,
	ref: id,
	title: id,
	readonly: false,
	swimlanes: [{id: `${id}-lane`, title: 'lane', readonly: false, issues}],
});

const boards = [
	board('board-work', [
		issue('ABC1234', 'issue-a'),
		issue('XYZ9876', 'issue-c'),
	]),
	board('board-roadmap', [issue('GB1V92X', 'issue-r')]),
];

// `XYZ9876` closed: it has left `board-work` for the global Closed board, and
// the commits linked to it are still that board's work.
const withClosed = [
	board('board-work', [issue('ABC1234', 'issue-a')]),
	board('board-roadmap', [issue('GB1V92X', 'issue-r')]),
	board('board-closed', [issue('XYZ9876', 'issue-c', 'board-work')]),
];

describe('issueIdByRefFor', () => {
	it('takes every board in with no board named', () => {
		expect([...issueIdByRefFor(boards, null)]).toEqual([
			['ABC1234', 'issue-a'],
			['XYZ9876', 'issue-c'],
			['GB1V92X', 'issue-r'],
		]);
	});

	it('takes in the named board alone', () => {
		expect([...issueIdByRefFor(boards, 'board-roadmap')]).toEqual([
			['GB1V92X', 'issue-r'],
		]);
	});

	// Closing is what most tickets end up doing. Reading a closed ticket's board
	// as the Closed board alone would take nearly every commit ever linked to a
	// board out of that board's own log.
	it('keeps a closed ticket for the board it was closed from', () => {
		expect([...issueIdByRefFor(withClosed, 'board-work')]).toEqual([
			['ABC1234', 'issue-a'],
			['XYZ9876', 'issue-c'],
		]);
	});

	it('keeps it on the Closed board it now sits on too', () => {
		expect([...issueIdByRefFor(withClosed, 'board-closed')]).toEqual([
			['XYZ9876', 'issue-c'],
		]);
	});

	it('does not lend it to a board it was never on', () => {
		expect([...issueIdByRefFor(withClosed, 'board-roadmap')]).toEqual([
			['GB1V92X', 'issue-r'],
		]);
	});

	// Why the funnel down to one ticket reads the repository's map and not the
	// board's: a ref link opens a ticket from another board without leaving this
	// one, and the board's map does not carry it — so the funnel would answer
	// with nothing for a ticket that has commits.
	it('finds nothing for a focused ticket the board does not carry', () => {
		const focus = new Set(['issue-a']);

		expect(
			keptCommits(
				commits,
				false,
				true,
				issueIdByRefFor(boards, 'board-roadmap'),
				focus,
			),
		).toEqual([]);

		expect(
			keptCommits(
				commits,
				false,
				true,
				issueIdByRefFor(boards, null),
				focus,
			).map(c => c.sha),
		).toEqual(['a']);
	});

	// What the log hands `keptCommits`: a board carrying one ticket nothing is
	// committed against lists no commits at all, rather than the repository's.
	it('leaves another board’s commits unlinked', () => {
		expect(
			keptCommits(
				commits,
				true,
				false,
				issueIdByRefFor(boards, 'board-roadmap'),
				null,
			),
		).toEqual([]);
	});
});

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
