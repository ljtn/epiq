import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	discoverCoverageReport,
	parseLcov,
	readConfiguredCoveragePath,
} from '../lib/stats/coverage-report.js';

const lcov = [
	'TN:',
	'SF:source/app.ts',
	'DA:1,3',
	'DA:2,0',
	'DA:5,1',
	'LF:3',
	'LH:2',
	'end_of_record',
	'SF:./source/other.ts',
	'DA:1,0',
	'end_of_record',
	'',
].join('\n');

describe('parseLcov', () => {
	it('reads per-line hits and the report own totals', () => {
		const report = parseLcov(lcov, '/repo');

		expect(report.hitsByPath.get('source/app.ts')?.get(1)).toBe(3);
		expect(report.hitsByPath.get('source/app.ts')?.get(2)).toBe(0);
		expect(report.totalLines).toBe(4);
		expect(report.totalCovered).toBe(2);
	});

	it('normalises a leading ./ and an absolute path to repo-relative', () => {
		const report = parseLcov(
			['SF:/repo/source/absolute.ts', 'DA:1,1', 'end_of_record'].join('\n'),
			'/repo',
		);

		expect([...report.hitsByPath.keys()]).toEqual(['source/absolute.ts']);
		expect(parseLcov(lcov, '/repo').hitsByPath.has('source/other.ts')).toBe(
			true,
		);
	});

	it('merges a file listed twice rather than losing the first run', () => {
		const report = parseLcov(
			[
				'SF:source/app.ts',
				'DA:1,0',
				'end_of_record',
				'SF:source/app.ts',
				'DA:1,4',
				'end_of_record',
			].join('\n'),
			'/repo',
		);

		expect(report.hitsByPath.get('source/app.ts')?.get(1)).toBe(4);
		expect(report.totalLines).toBe(1);
		expect(report.totalCovered).toBe(1);
	});
});

describe('discoverCoverageReport', () => {
	let repoRoot = '';

	beforeEach(() => {
		repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-coverage-'));
	});

	afterEach(() => {
		fs.rmSync(repoRoot, {recursive: true, force: true});
	});

	const write = (relative: string, contents: string) => {
		const target = path.join(repoRoot, relative);
		fs.mkdirSync(path.dirname(target), {recursive: true});
		fs.writeFileSync(target, contents);
	};

	it('finds nothing in a repo with no report, and says so as null', () => {
		expect(discoverCoverageReport(repoRoot)).toBeNull();
	});

	it('finds a report at a conventional path', () => {
		write('coverage/lcov.info', lcov);

		const report = discoverCoverageReport(repoRoot);

		expect(report?.path).toBe('coverage/lcov.info');
		expect(report?.totalCovered).toBe(2);
		expect(report?.modifiedAt).toBeGreaterThan(0);
	});

	it('prefers the path the repo configured', () => {
		write('coverage/lcov.info', lcov);
		write('reports/mine.info', ['SF:source/x.ts', 'DA:1,1'].join('\n'));
		write(
			'.epiq/stats.json',
			JSON.stringify({coverage: {path: 'reports/mine.info'}}),
		);

		expect(readConfiguredCoveragePath(repoRoot)).toBe('reports/mine.info');
		expect(discoverCoverageReport(repoRoot)?.path).toBe('reports/mine.info');
	});

	it('falls back to the conventional paths when the config is unreadable', () => {
		write('coverage/lcov.info', lcov);
		write('.epiq/stats.json', 'not json at all');

		expect(readConfiguredCoveragePath(repoRoot)).toBeNull();
		expect(discoverCoverageReport(repoRoot)?.path).toBe('coverage/lcov.info');
	});

	it('falls back when the configured path does not exist', () => {
		write('coverage/lcov.info', lcov);
		write('.epiq/stats.json', JSON.stringify({coverage: {path: 'gone.info'}}));

		expect(discoverCoverageReport(repoRoot)?.path).toBe('coverage/lcov.info');
	});
});
