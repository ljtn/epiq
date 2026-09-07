import {describe, expect, it} from 'vitest';
import {IssueStatsState, needsStats} from './use-issue-detail';

const held = (patch: Partial<IssueStatsState> = {}): IssueStatsState => ({
	issueId: 'issue-1',
	signature: 'sha-1',
	loading: false,
	error: null,
	stats: null,
	...patch,
});

describe('needsStats', () => {
	it('asks when there is nothing on screen', () => {
		expect(needsStats(null, 'issue-1', 'sha-1')).toBe(true);
	});

	it('does not ask again for the ticket it is already showing', () => {
		expect(needsStats(held(), 'issue-1', 'sha-1')).toBe(false);
	});

	it('asks again for a different ticket', () => {
		expect(needsStats(held(), 'issue-2', 'sha-1')).toBe(true);
	});

	// A commit landing on the open ticket makes what is on screen wrong, and
	// nothing else on the page would ask again.
	it('asks again when a new commit lands on the same ticket', () => {
		expect(needsStats(held(), 'issue-1', 'sha-2')).toBe(true);
	});

	// Without this the tab shows the same failure until the reader switches
	// tickets and back.
	it('retries an answer that failed', () => {
		expect(needsStats(held({error: 'git exploded'}), 'issue-1', 'sha-1')).toBe(
			true,
		);
	});
});
