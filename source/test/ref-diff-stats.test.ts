import {describe, expect, it} from 'vitest';
import {collectRefDiffStats} from '../mcp/api/ref-diff-stats.js';
import {CommitEntry} from '../lib/commits/commits.js';

const commit = (
	subject: string,
	insertions = 0,
	deletions = 0,
): CommitEntry => ({
	sha: subject.slice(0, 7),
	time: 0,
	author: 'someone',
	authorEmail: 'someone@example.com',
	subject,
	linesChanged: insertions + deletions,
	insertions,
	deletions,
});

describe('collectRefDiffStats', () => {
	it('adds up every commit naming one ref', () => {
		const stats = collectRefDiffStats([
			commit('B8PYTCM first go', 10, 2),
			commit('B8PYTCM second go', 5, 40),
		]);

		expect(stats['B8PYTCM']).toEqual({
			commits: 2,
			insertions: 15,
			deletions: 42,
		});
	});

	it('keeps one ref out of another', () => {
		const stats = collectRefDiffStats([
			commit('B8PYTCM mine', 10, 2),
			commit('W1TCS14 yours', 1, 1),
		]);

		expect(Object.keys(stats).sort()).toEqual(['B8PYTCM', 'W1TCS14']);
	});

	// Matching is `getCommitsForRef`'s: the same rule, so the bar on the card
	// and the commit list behind it can never disagree about a commit.
	it('matches a ref written in any case, under its upper-case name', () => {
		const stats = collectRefDiffStats([commit('b8pytcm typed by hand', 3, 1)]);

		expect(stats['B8PYTCM']).toEqual({commits: 1, insertions: 3, deletions: 1});
	});

	it('ignores a subject that names no ticket', () => {
		const stats = collectRefDiffStats([
			commit('housekeeping', 9, 9),
			commit('TOOLONGREF something', 9, 9),
			commit('SHORT something', 9, 9),
			commit('B8PYTC. punctuation', 9, 9),
		]);

		expect(stats).toEqual({});
	});

	// A subject that is a bare ref and nothing else is not a match for
	// `getCommitsForRef` either, which looks for the ref *and a space*.
	it('ignores a subject that is a ref with no message after it', () => {
		expect(collectRefDiffStats([commit('B8PYTCM', 9, 9)])).toEqual({});
	});

	it('counts a commit that changed nothing, so the ticket still has commits', () => {
		const stats = collectRefDiffStats([commit('B8PYTCM empty')]);

		expect(stats['B8PYTCM']).toEqual({commits: 1, insertions: 0, deletions: 0});
	});
});
