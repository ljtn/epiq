import {beforeEach, describe, expect, it, vi} from 'vitest';
import {succeeded} from '../lib/model/result-types.js';

vi.mock('../lib/storage/paths.js', () => ({
	resolveClosestEpiqProjectRoot: vi.fn(() => succeeded('Resolved', '/repo')),
	NO_PROJECT_MESSAGE: 'No .epiq/project.json found in any parent',
}));

vi.mock('../mcp/epiq-time-travel.js', () => ({
	getCommitsForRef: vi.fn(),
}));

vi.mock('../lib/stats/coverage-report.js', () => ({
	discoverCoverageReport: vi.fn(),
}));

vi.mock('../lib/stats/issue-stats.js', () => ({
	deriveIssueStats: vi.fn(),
}));

vi.mock('../git/git-utils.js', () => ({
	execGitAllowFail: vi.fn(),
}));

const {getCommitsForRef} = await import('../mcp/epiq-time-travel.js');
const {discoverCoverageReport} = await import(
	'../lib/stats/coverage-report.js'
);
const {deriveIssueStats} = await import('../lib/stats/issue-stats.js');
const {execGitAllowFail} = await import('../git/git-utils.js');
const {getIssueStats, resetIssueStatsCacheForTests} = await import(
	'../mcp/epiq-issue-stats.js'
);

const derive = vi.mocked(deriveIssueStats);
const commits = vi.mocked(getCommitsForRef);
const discover = vi.mocked(discoverCoverageReport);
const git = vi.mocked(execGitAllowFail);

const REF = 'ABC1234';

const headIs = (sha: string) =>
	git.mockResolvedValue({stdout: `${sha}\n`, stderr: '', exitCode: 0});

describe('getIssueStats caching', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetIssueStatsCacheForTests();

		commits.mockResolvedValue(
			succeeded('Matched', [
				{
					sha: 'commit-1',
					time: 1,
					author: 'jola',
					subject: `${REF} one`,
					linesChanged: 1,
					insertions: 1,
					deletions: 0,
					precedingSha: null,
				},
			]),
		);

		derive.mockImplementation(async ({ref}) =>
			succeeded('Derived', {ref} as never),
		);

		discover.mockReturnValue(null);
		headIs('head-1');
	});

	it('answers a repeat ask from the cache', async () => {
		await getIssueStats({idOrRef: REF, repoRoot: '/repo'});
		await getIssueStats({idOrRef: REF, repoRoot: '/repo'});

		expect(derive).toHaveBeenCalledTimes(1);
	});

	// The bug this pins: with the report absent on the first ask, a cache keyed
	// only on the shas went on answering "no coverage report found" for the
	// life of the process, however many times the tests were run.
	it('asks again once a coverage report appears', async () => {
		await getIssueStats({idOrRef: REF, repoRoot: '/repo'});

		discover.mockReturnValue({
			path: 'coverage/lcov.info',
			format: 'lcov',
			modifiedAt: 1000,
			hitsByPath: new Map(),
			totalLines: 0,
			totalCovered: 0,
		});

		await getIssueStats({idOrRef: REF, repoRoot: '/repo'});

		expect(derive).toHaveBeenCalledTimes(2);
	});

	it('asks again when the report is rewritten by a later test run', async () => {
		const report = {
			path: 'coverage/lcov.info',
			format: 'lcov' as const,
			modifiedAt: 1000,
			hitsByPath: new Map(),
			totalLines: 0,
			totalCovered: 0,
		};

		discover.mockReturnValue(report);
		await getIssueStats({idOrRef: REF, repoRoot: '/repo'});

		discover.mockReturnValue({...report, modifiedAt: 2000});
		await getIssueStats({idOrRef: REF, repoRoot: '/repo'});

		expect(derive).toHaveBeenCalledTimes(2);
	});

	// Surviving lines and coverage are read against HEAD, so an unrelated
	// commit landing makes the held answer stale.
	it('asks again when HEAD moves', async () => {
		await getIssueStats({idOrRef: REF, repoRoot: '/repo'});

		headIs('head-2');
		await getIssueStats({idOrRef: REF, repoRoot: '/repo'});

		expect(derive).toHaveBeenCalledTimes(2);
	});
});
