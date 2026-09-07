import {describe, expect, it} from 'vitest';
import {deriveChangeShape} from '../lib/stats/change-shape.js';
import {parsePatchOutput} from '../lib/stats/patch-scan.js';

const REC = '\x1e';

// Shaped exactly as `git show --unified=0 --no-renames` writes it, since that
// is the whole point of the parser.
const patch = (sha: string, body: string[]): string =>
	[`${REC}${sha}`, ...body].join('\n');

describe('parsePatchOutput', () => {
	it('reads added lines with the line numbers their hunk header gives', () => {
		const parsed = parsePatchOutput(
			patch('aaa', [
				'diff --git a/src/app.ts b/src/app.ts',
				'--- a/src/app.ts',
				'+++ b/src/app.ts',
				'@@ -0,0 +12,2 @@',
				'+const one = 1;',
				'+const two = 2;',
			]),
		);

		expect(parsed.insertions).toBe(2);
		expect(parsed.files[0]?.added).toEqual([
			{sha: 'aaa', line: 12, text: 'const one = 1;'},
			{sha: 'aaa', line: 13, text: 'const two = 2;'},
		]);
	});

	it('tells an added file from a modified one and a deleted one', () => {
		const parsed = parsePatchOutput(
			[
				patch('aaa', [
					'diff --git a/new.ts b/new.ts',
					'--- /dev/null',
					'+++ b/new.ts',
					'@@ -0,0 +1 @@',
					'+fresh',
				]),
				patch('bbb', [
					'diff --git a/old.ts b/old.ts',
					'--- a/old.ts',
					'+++ /dev/null',
					'@@ -1 +0,0 @@',
					'-gone',
				]),
			].join('\n'),
		);

		expect(
			parsed.files.map(file => [file.path, file.status, file.removed]),
		).toEqual([
			['new.ts', 'added', 0],
			['old.ts', 'deleted', 1],
		]);
	});

	it('keeps a binary file, with no line counts to give', () => {
		const parsed = parsePatchOutput(
			patch('aaa', [
				'diff --git a/logo.png b/logo.png',
				'index 1111111..2222222 100644',
				'Binary files a/logo.png and b/logo.png differ',
			]),
		);

		expect(parsed.files).toHaveLength(1);
		expect(parsed.files[0]?.binary).toBe(true);
		expect(parsed.insertions).toBe(0);
	});

	it('folds a path touched by several commits into one entry', () => {
		const parsed = parsePatchOutput(
			[
				patch('aaa', [
					'diff --git a/app.ts b/app.ts',
					'--- a/app.ts',
					'+++ b/app.ts',
					'@@ -1 +1 @@',
					'+first',
				]),
				patch('bbb', [
					'diff --git a/app.ts b/app.ts',
					'--- a/app.ts',
					'+++ b/app.ts',
					'@@ -2 +2 @@',
					'+second',
				]),
			].join('\n'),
		);

		expect(parsed.files).toHaveLength(1);
		expect(parsed.files[0]?.shas).toEqual(['aaa', 'bbb']);
		expect(parsed.files[0]?.added).toHaveLength(2);
	});

	it('counts a line the ticket added and later removed as self-churn', () => {
		const parsed = parsePatchOutput(
			[
				patch('aaa', [
					'diff --git a/app.ts b/app.ts',
					'--- a/app.ts',
					'+++ b/app.ts',
					'@@ -0,0 +1 @@',
					'+const wrong = compute();',
				]),
				patch('bbb', [
					'diff --git a/app.ts b/app.ts',
					'--- a/app.ts',
					'+++ b/app.ts',
					'@@ -1 +1 @@',
					'-const wrong = compute();',
					'+const right = compute();',
				]),
			].join('\n'),
		);

		expect(parsed.selfChurn).toBe(1);
		expect(parsed.insertions).toBe(2);
		expect(parsed.deletions).toBe(1);
	});

	it('does not call removing a line somebody else wrote self-churn', () => {
		const parsed = parsePatchOutput(
			patch('aaa', [
				'diff --git a/app.ts b/app.ts',
				'--- a/app.ts',
				'+++ b/app.ts',
				'@@ -1 +1 @@',
				'-const previouslyThere = 1;',
				'+const mine = 1;',
			]),
		);

		expect(parsed.selfChurn).toBe(0);
	});

	it('ignores near-blank lines, which match each other everywhere', () => {
		const parsed = parsePatchOutput(
			[
				patch('aaa', [
					'diff --git a/app.ts b/app.ts',
					'--- a/app.ts',
					'+++ b/app.ts',
					'@@ -0,0 +1,2 @@',
					'+}',
					'+',
				]),
				patch('bbb', [
					'diff --git a/app.ts b/app.ts',
					'--- a/app.ts',
					'+++ b/app.ts',
					'@@ -1,2 +0,0 @@',
					'-}',
					'-',
				]),
			].join('\n'),
		);

		expect(parsed.selfChurn).toBe(0);
	});
});

describe('deriveChangeShape', () => {
	const commits = [
		{sha: 'aaa', time: 1000, author: 'jola', subject: 'ABC1234 one'},
		{sha: 'bbb', time: 3000, author: 'claude/oskar', subject: 'ABC1234 two'},
	];

	const patchOf = (stdout: string) => {
		const parsed = parsePatchOutput(stdout);

		return {
			files: parsed.files,
			insertions: parsed.insertions,
			deletions: parsed.deletions,
			selfChurn: parsed.selfChurn,
			scannedCommits: commits.length,
			truncated: false,
		};
	};

	it('counts directories, not just files', () => {
		const shape = deriveChangeShape({
			commits,
			patch: patchOf(
				[
					patch('aaa', [
						'diff --git a/src/one/a.ts b/src/one/a.ts',
						'--- a/src/one/a.ts',
						'+++ b/src/one/a.ts',
						'@@ -0,0 +1 @@',
						'+a',
					]),
					patch('aaa', [
						'diff --git a/src/two/b.ts b/src/two/b.ts',
						'--- a/src/two/b.ts',
						'+++ b/src/two/b.ts',
						'@@ -0,0 +1 @@',
						'+b',
					]),
				].join('\n'),
			),
		});

		expect(shape.files).toBe(2);
		expect(shape.directories).toBe(2);
	});

	it('names the busiest file and its share of the change', () => {
		const shape = deriveChangeShape({
			commits,
			patch: patchOf(
				[
					patch('aaa', [
						'diff --git a/big.ts b/big.ts',
						'--- a/big.ts',
						'+++ b/big.ts',
						'@@ -0,0 +1,3 @@',
						'+one',
						'+two',
						'+three',
					]),
					patch('aaa', [
						'diff --git a/small.ts b/small.ts',
						'--- a/small.ts',
						'+++ b/small.ts',
						'@@ -0,0 +1 @@',
						'+one',
					]),
				].join('\n'),
			),
		});

		expect(shape.largestFile).toEqual({path: 'big.ts', changed: 3});
		expect(shape.concentration).toBeCloseTo(0.75);
	});

	it('reports each author once and the span the commits cover', () => {
		const shape = deriveChangeShape({commits, patch: patchOf('')});

		expect(shape.authors).toEqual(['claude/oskar', 'jola']);
		expect(shape.firstCommitAt).toBe(1000);
		expect(shape.lastCommitAt).toBe(3000);
		expect(shape.largestFile).toBeNull();
		expect(shape.concentration).toBe(0);
	});
});
