import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('../git/git-utils.js', () => ({
	execGitAllowFail: vi.fn(),
}));

const {execGitAllowFail} = await import('../git/git-utils.js');
const {derivePatchCoverage} = await import('../lib/stats/patch-coverage.js');
const {parseLcov} = await import('../lib/stats/coverage-report.js');
const {parsePatchOutput} = await import('../lib/stats/patch-scan.js');

const mocked = vi.mocked(execGitAllowFail);

const REC = '\x1e';

const patchOf = (path: string, added: string[]) => {
	const parsed = parsePatchOutput(
		[
			`${REC}aaa`,
			`diff --git a/${path} b/${path}`,
			`--- a/${path}`,
			`+++ b/${path}`,
			`@@ -0,0 +1,${added.length} @@`,
			...added.map(text => `+${text}`),
		].join('\n'),
	);

	return {
		files: parsed.files,
		insertions: parsed.insertions,
		deletions: parsed.deletions,
		selfChurn: parsed.selfChurn,
		scannedCommits: 1,
		truncated: false,
	};
};

// `git blame --line-porcelain` writes a header line per line of the file,
// then the line's own content. Only the header matters here.
const blameOf = (lines: {sha: string; line: number}[]): string =>
	lines
		.map(({sha, line}) =>
			[`${sha} ${line} ${line} 1`, '\tsome code'].join('\n'),
		)
		.join('\n');

const report = (repoRoot: string, body: string[]) => ({
	path: 'coverage/lcov.info',
	format: 'lcov' as const,
	modifiedAt: 2000,
	...parseLcov(body.join('\n'), repoRoot),
});

const ok = (stdout: string) => ({stdout, stderr: '', exitCode: 0});
const fail = () => ({stdout: '', stderr: 'no', exitCode: 1});

const TICKET_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

describe('derivePatchCoverage', () => {
	beforeEach(() => {
		mocked.mockReset();
	});

	it('counts a ticket own surviving lines in each of the four states', async () => {
		mocked.mockImplementation(async ({args}) =>
			args[0] === 'merge-base'
				? ok('')
				: ok(
						blameOf([
							{sha: TICKET_SHA, line: 1},
							{sha: TICKET_SHA, line: 2},
							{sha: TICKET_SHA, line: 3},
							// Somebody else's line in the same file: not this ticket's
							// to be judged on.
							{sha: OTHER_SHA, line: 4},
						]),
				  ),
		);

		const coverage = await derivePatchCoverage({
			repoRoot: '/repo',
			patch: patchOf('source/app.ts', ['a', 'b', 'c']),
			shas: [TICKET_SHA],
			lastCommitAt: 1000,
			report: report('/repo', [
				'SF:source/app.ts',
				'DA:1,4',
				'DA:2,0',
				// Line 3 has no record: an instrumented file still has lines the
				// runner never counts.
				'DA:4,9',
				'end_of_record',
			]),
		});

		expect(coverage.anchored).toBe(true);
		expect(coverage.survivingLines).toBe(3);
		expect(coverage.covered).toBe(1);
		expect(coverage.uncovered).toBe(1);
		expect(coverage.notInstrumented).toBe(1);
		expect(coverage.notInReport).toBe(0);
	});

	it('keeps a file the report has never heard of out of the percentage', async () => {
		mocked.mockImplementation(async ({args}) =>
			args[0] === 'merge-base'
				? ok('')
				: ok(blameOf([{sha: TICKET_SHA, line: 1}])),
		);

		const coverage = await derivePatchCoverage({
			repoRoot: '/repo',
			patch: patchOf('source/ui.tsx', ['a']),
			shas: [TICKET_SHA],
			lastCommitAt: 1000,
			report: report('/repo', [
				'SF:source/other.ts',
				'DA:1,1',
				'end_of_record',
			]),
		});

		expect(coverage.notInReport).toBe(1);
		expect(coverage.covered + coverage.uncovered).toBe(0);
		expect(coverage.files[0]?.inReport).toBe(false);
	});

	it('says why rather than reporting nothing covered when the commits are elsewhere', async () => {
		mocked.mockImplementation(async ({args}) =>
			args[0] === 'merge-base' ? fail() : ok(''),
		);

		const coverage = await derivePatchCoverage({
			repoRoot: '/repo',
			patch: patchOf('source/app.ts', ['a']),
			shas: [TICKET_SHA],
			lastCommitAt: 1000,
			report: null,
		});

		expect(coverage.anchored).toBe(false);
		expect(coverage.notAnchoredReason).toMatch(/not in the current checkout/);
		expect(coverage.covered).toBe(0);
	});

	it('marks a report written before the ticket last commit as stale', async () => {
		mocked.mockImplementation(async ({args}) =>
			args[0] === 'merge-base'
				? ok('')
				: ok(blameOf([{sha: TICKET_SHA, line: 1}])),
		);

		const coverage = await derivePatchCoverage({
			repoRoot: '/repo',
			patch: patchOf('source/app.ts', ['a']),
			shas: [TICKET_SHA],
			// After the report's own modifiedAt of 2000.
			lastCommitAt: 3000,
			report: report('/repo', ['SF:source/app.ts', 'DA:1,1', 'end_of_record']),
		});

		expect(coverage.report?.olderThanLastCommit).toBe(true);
	});

	it('reports lines added beside lines still standing', async () => {
		mocked.mockImplementation(async ({args}) =>
			args[0] === 'merge-base'
				? ok('')
				: ok(blameOf([{sha: TICKET_SHA, line: 1}])),
		);

		const coverage = await derivePatchCoverage({
			repoRoot: '/repo',
			patch: patchOf('source/app.ts', ['a', 'b', 'c']),
			shas: [TICKET_SHA],
			lastCommitAt: 1000,
			report: null,
		});

		expect(coverage.linesAdded).toBe(3);
		expect(coverage.survivingLines).toBe(1);
	});
});
