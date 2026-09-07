import {describe, expect, it} from 'vitest';
import {
	isBuildOrCiPath,
	isDependencyManifest,
	isGeneratedPath,
	isTestPath,
	languageOf,
} from '../lib/stats/file-kinds.js';
import {deriveLanguages} from '../lib/stats/languages.js';
import {parsePatchOutput} from '../lib/stats/patch-scan.js';
import {deriveTestSignal} from '../lib/stats/test-signal.js';

const REC = '\x1e';

const file = (path: string, added: string[], removed: string[] = []): string =>
	[
		`${REC}aaa`,
		`diff --git a/${path} b/${path}`,
		`--- a/${path}`,
		`+++ b/${path}`,
		`@@ -1,${removed.length} +1,${added.length} @@`,
		...removed.map(text => `-${text}`),
		...added.map(text => `+${text}`),
	].join('\n');

const patchOf = (stdout: string) => {
	const parsed = parsePatchOutput(stdout);

	return {
		files: parsed.files,
		insertions: parsed.insertions,
		deletions: parsed.deletions,
		selfChurn: parsed.selfChurn,
		scannedCommits: 1,
		truncated: false,
	};
};

describe('file-kinds', () => {
	it('names a language by extension and falls back to Other', () => {
		expect(languageOf('source/app.tsx')).toBe('TypeScript');
		expect(languageOf('scripts/deploy.sh')).toBe('Shell');
		expect(languageOf('main.go')).toBe('Go');
		expect(languageOf('LICENSE')).toBe('Other');
		expect(languageOf('.gitignore')).toBe('Other');
	});

	it('recognises the test conventions of several languages', () => {
		expect(isTestPath('source/test/thing.test.ts')).toBe(true);
		expect(isTestPath('pkg/server_test.go')).toBe(true);
		expect(isTestPath('app/tests/test_views.py')).toBe(true);
		expect(isTestPath('src/test/java/AppTest.java')).toBe(true);
		expect(isTestPath('source/lib/stats/patch-scan.ts')).toBe(false);
		// "latest" contains "test" and is not one.
		expect(isTestPath('source/latest-version.ts')).toBe(false);
	});

	it('keeps generated files apart from written ones', () => {
		expect(isGeneratedPath('package-lock.json')).toBe(true);
		expect(isGeneratedPath('dist/index.js')).toBe(true);
		expect(isGeneratedPath('source/app.ts')).toBe(false);
		expect(isDependencyManifest('package.json')).toBe(true);
		expect(isBuildOrCiPath('.github/workflows/ci.yml')).toBe(true);
	});
});

describe('deriveLanguages', () => {
	it('counts lines per language and splits out the test share', () => {
		const breakdown = deriveLanguages({
			patch: patchOf(
				[
					file('source/app.ts', ['const a = 1;', 'const b = 2;']),
					file('source/test/app.test.ts', ['expect(a).toBe(1);']),
					file('deploy.sh', ['echo hi']),
				].join('\n'),
			),
			languagesBefore: new Set(['TypeScript', 'Shell']),
		});

		expect(breakdown.languages).toEqual([
			{name: 'TypeScript', added: 3, removed: 0, addedInTests: 1, share: 0.75},
			{name: 'Shell', added: 1, removed: 0, addedInTests: 0, share: 0.25},
		]);
		expect(breakdown.introduced).toEqual([]);
	});

	it('names a language the repo did not have before', () => {
		const breakdown = deriveLanguages({
			patch: patchOf(file('main.go', ['package main'])),
			languagesBefore: new Set(['TypeScript']),
		});

		expect(breakdown.introduced).toEqual(['Go']);
	});

	it('claims nothing is new when there is no baseline to compare against', () => {
		const breakdown = deriveLanguages({
			patch: patchOf(file('main.go', ['package main'])),
			languagesBefore: null,
		});

		expect(breakdown.introduced).toEqual([]);
	});

	it('keeps generated lines out of the language split', () => {
		const breakdown = deriveLanguages({
			patch: patchOf(
				[
					file('source/app.ts', ['const a = 1;']),
					file('package-lock.json', [
						'"resolved": "..."',
						'"integrity": "..."',
					]),
				].join('\n'),
			),
			languagesBefore: new Set(['TypeScript', 'JSON']),
		});

		expect(breakdown.languages).toEqual([
			{name: 'TypeScript', added: 1, removed: 0, addedInTests: 0, share: 1},
		]);
		expect(breakdown.generatedLines).toBe(2);
	});
});

describe('deriveTestSignal', () => {
	it('counts the test lines and leaves the code beside them alone', () => {
		const signal = deriveTestSignal({
			patch: patchOf(
				[
					file('source/app.ts', ['const a = 1;', 'const b = 2;']),
					file('source/test/app.test.ts', ['expect(a).toBe(1);']),
				].join('\n'),
			),
		});

		expect(signal.testLinesAdded).toBe(1);
	});

	it('counts test lines added to a file that already existed', () => {
		const signal = deriveTestSignal({
			patch: patchOf(
				file('source/test/app.test.ts', [
					'expect(a).toBe(1);',
					'expect(b).toBe(2);',
				]),
			),
		});

		// No new test file, which is not the same as no new tests — the reason
		// the count is lines rather than files.
		expect(signal.addedTestFiles).toEqual([]);
		expect(signal.testLinesAdded).toBe(2);
	});

	it('counts deleted test files and removed test lines', () => {
		const parsed = parsePatchOutput(
			[
				`${REC}aaa`,
				'diff --git a/source/test/old.test.ts b/source/test/old.test.ts',
				'--- a/source/test/old.test.ts',
				'+++ /dev/null',
				'@@ -1,2 +0,0 @@',
				'-it("works", () => {});',
				'-it("also works", () => {});',
			].join('\n'),
		);

		const signal = deriveTestSignal({
			patch: {
				files: parsed.files,
				insertions: parsed.insertions,
				deletions: parsed.deletions,
				selfChurn: parsed.selfChurn,
				scannedCommits: 1,
				truncated: false,
			},
		});

		// The file itself, not just a count: the Stats tab links to it.
		expect(signal.deletedTestFiles).toEqual([
			{path: 'source/test/old.test.ts', sha: 'aaa'},
		]);
		expect(signal.testLinesRemoved).toBe(2);
	});

	it('spots a skipped test and a focused one', () => {
		const signal = deriveTestSignal({
			patch: patchOf(
				file('source/test/app.test.ts', [
					'it.skip("later", () => {});',
					'it.only("this one", () => {});',
					'it("normal", () => {});',
				]),
			),
		});

		expect(signal.skippedTestLinesAdded).toBe(1);
		expect(signal.focusedTestLinesAdded).toBe(1);
	});
});
