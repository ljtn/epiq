import {beforeEach, describe, expect, it, vi} from 'vitest';
import {succeeded} from '../lib/model/result-types.js';

vi.mock('../lib/storage/paths.js', () => ({
	resolveClosestEpiqProjectRoot: vi.fn(() => succeeded('Resolved', '/repo')),
	NO_PROJECT_MESSAGE: 'No .epiq/project.json found in any parent',
}));

vi.mock('../mcp/epiq-time-travel.js', () => ({
	getCommitsForRef: vi.fn(),
}));

vi.mock('../lib/stats/issue-stats.js', () => ({
	deriveIssueStats: vi.fn(),
}));

const {getCommitsForRef} = await import('../mcp/epiq-time-travel.js');
const {deriveIssueStats} = await import('../lib/stats/issue-stats.js');
const {getIssueStats, resetIssueStatsCacheForTests} = await import(
	'../mcp/epiq-issue-stats.js'
);

const derive = vi.mocked(deriveIssueStats);
const commits = vi.mocked(getCommitsForRef);

const REF = 'ABC1234';

const commitNamed = (sha: string) => ({
	sha,
	time: 1,
	author: 'jola',
	subject: `${REF} one`,
	linesChanged: 1,
	insertions: 1,
	deletions: 0,
	precedingSha: null,
});

describe('getIssueStats caching', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetIssueStatsCacheForTests();

		commits.mockResolvedValue(succeeded('Matched', [commitNamed('commit-1')]));

		derive.mockImplementation(async ({ref}) =>
			succeeded('Derived', {ref} as never),
		);
	});

	it('answers a repeat ask from the cache', async () => {
		await getIssueStats({idOrRef: REF, repoRoot: '/repo'});
		await getIssueStats({idOrRef: REF, repoRoot: '/repo'});

		expect(derive).toHaveBeenCalledTimes(1);
	});

	// The shas are the whole of what the answer depends on, so a new commit on
	// the ticket has to be a new key — nothing else here would notice.
	it('scans again when the ticket gains a commit', async () => {
		await getIssueStats({idOrRef: REF, repoRoot: '/repo'});

		commits.mockResolvedValue(
			succeeded('Matched', [commitNamed('commit-2'), commitNamed('commit-1')]),
		);

		await getIssueStats({idOrRef: REF, repoRoot: '/repo'});

		expect(derive).toHaveBeenCalledTimes(2);
	});

	it('keeps one ticket answer out of another', async () => {
		await getIssueStats({idOrRef: REF, repoRoot: '/repo'});
		await getIssueStats({idOrRef: 'ZZZ9999', repoRoot: '/repo'});

		expect(derive).toHaveBeenCalledTimes(2);
	});
});
