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

	// A file created in one commit and edited in the next is still a file this
	// ticket created; reading it as "modified" made every new file in a
	// multi-commit ticket disappear from "N added".
	it('keeps a file added, even after a later commit edits it', () => {
		const parsed = parsePatchOutput(
			[
				patch('aaa', [
					'diff --git a/new.ts b/new.ts',
					'--- /dev/null',
					'+++ b/new.ts',
					'@@ -0,0 +1 @@',
					'+first',
				]),
				patch('bbb', [
					'diff --git a/new.ts b/new.ts',
					'--- a/new.ts',
					'+++ b/new.ts',
					'@@ -1 +1,2 @@',
					'+second',
				]),
			].join('\n'),
		);

		expect(parsed.files[0]?.status).toBe('added');
	});

	it('still reads a file the ticket added and later deleted as deleted', () => {
		const parsed = parsePatchOutput(
			[
				patch('aaa', [
					'diff --git a/tmp.ts b/tmp.ts',
					'--- /dev/null',
					'+++ b/tmp.ts',
					'@@ -0,0 +1 @@',
					'+first',
				]),
				patch('bbb', [
					'diff --git a/tmp.ts b/tmp.ts',
					'--- a/tmp.ts',
					'+++ /dev/null',
					'@@ -1 +0,0 @@',
					'-first',
				]),
			].join('\n'),
		);

		expect(parsed.files[0]?.status).toBe('deleted');
	});

	// A removed SQL or Haskell comment (`-- old`) is written in the patch as
	// `--- old`, and an added line reading `++ marker` as `+++ marker`. Read as
	// file headers, they invented a file and swallowed the rest of the real
	// one's diff.
	it('does not mistake content beginning ++ or -- for a file header', () => {
		const parsed = parsePatchOutput(
			patch('aaa', [
				'diff --git a/query.sql b/query.sql',
				'--- a/query.sql',
				'+++ b/query.sql',
				'@@ -1 +1,2 @@',
				'--- old comment',
				'+++ marker',
				'+select 1;',
			]),
		);

		expect(parsed.files.map(file => file.path)).toEqual(['query.sql']);
		expect(parsed.insertions).toBe(2);
		expect(parsed.deletions).toBe(1);
		expect(parsed.files[0]?.added.map(line => line.text)).toEqual([
			'++ marker',
			'select 1;',
		]);
	});

	it('reads an added binary file as added, not modified', () => {
		const parsed = parsePatchOutput(
			[
				patch('aaa', [
					'diff --git a/logo.png b/logo.png',
					'index 0000000..2222222 100644',
					'Binary files /dev/null and b/logo.png differ',
				]),
				patch('bbb', [
					'diff --git a/old.png b/old.png',
					'index 1111111..0000000 100644',
					'Binary files a/old.png and /dev/null differ',
				]),
			].join('\n'),
		);

		expect(
			parsed.files.map(file => [file.path, file.status, file.binary]),
		).toEqual([
			['logo.png', 'added', true],
			['old.png', 'deleted', true],
		]);
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

		expect(shape.largestFile).toEqual({path: 'big.ts', sha: 'aaa', changed: 3});
		expect(shape.concentration).toBeCloseTo(0.75);
	});

	// Line *text* is capped and line *counts* are not, so the two part company
	// on a huge ticket. Anything that is a number reads the counts, or the
	// figures on the page stop adding up to the +/- at the top of it.
	it('sizes a file by its true line count, not by how much text was kept', () => {
		const parsed = parsePatchOutput(
			patch('aaa', [
				'diff --git a/huge.ts b/huge.ts',
				'--- a/huge.ts',
				'+++ b/huge.ts',
				'@@ -0,0 +1 @@',
				'+kept',
			]),
		);

		const [file] = parsed.files;
		if (!file) throw new Error('expected a file');

		// What a capped scan looks like: one line of text kept, 5000 counted.
		file.addedCount = 5_000;

		const shape = deriveChangeShape({
			commits,
			patch: {
				files: parsed.files,
				insertions: 5_000,
				deletions: 0,
				selfChurn: 0,
				scannedCommits: 1,
				truncated: true,
			},
		});

		expect(shape.largestFile).toEqual({
			path: 'huge.ts',
			sha: 'aaa',
			changed: 5_000,
		});
		expect(shape.concentration).toBe(1);
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
