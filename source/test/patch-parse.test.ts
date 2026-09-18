import {describe, expect, it} from 'vitest';

import {
	parsePatch,
	patchRows,
	renamedFrom,
} from '../lib/commits/patch-parse.js';

// Real `git show` output shapes. The line numbers are the part that has to be
// right: a comment anchored to a diff line is anchored by them.

describe('parsePatch', () => {
	it('numbers each side from the hunk header', () => {
		const files = parsePatch(
			[
				'diff --git a/source/a.ts b/source/a.ts',
				'index 1111111..2222222 100644',
				'--- a/source/a.ts',
				'+++ b/source/a.ts',
				'@@ -10,4 +10,5 @@ export const thing = () => {',
				' const before = 1;',
				'-const gone = 2;',
				'+const added = 2;',
				'+const alsoAdded = 3;',
				' const after = 4;',
			].join('\n'),
		);

		expect(files).toHaveLength(1);

		const file = files[0]!;
		expect(file.path).toBe('source/a.ts');
		expect(file.added).toBe(2);
		expect(file.removed).toBe(1);

		expect(
			file.lines.map(line => [line.kind, line.oldLine, line.newLine]),
		).toEqual([
			['hunk', undefined, undefined],
			['context', 10, 10],
			['removed', 11, undefined],
			['added', undefined, 11],
			['added', undefined, 12],
			['context', 12, 13],
		]);
	});

	it('reads a hunk header with no line count as one line', () => {
		const files = parsePatch(
			['--- a/x', '+++ b/x', '@@ -3 +3 @@', '-old', '+new'].join('\n'),
		);

		expect(files[0]!.lines[1]).toMatchObject({kind: 'removed', oldLine: 3});
		expect(files[0]!.lines[2]).toMatchObject({kind: 'added', newLine: 3});
	});

	it('carries an added file under its new path, with no old one', () => {
		const files = parsePatch(
			[
				'diff --git a/new.ts b/new.ts',
				'new file mode 100644',
				'--- /dev/null',
				'+++ b/new.ts',
				'@@ -0,0 +1,2 @@',
				'+one',
				'+two',
			].join('\n'),
		);

		expect(files[0]!.path).toBe('new.ts');
		expect(files[0]!.oldPath).toBeNull();
		expect(files[0]!.added).toBe(2);
	});

	it('keeps a deleted file’s name, which only the old side has', () => {
		const files = parsePatch(
			[
				'diff --git a/gone.ts b/gone.ts',
				'deleted file mode 100644',
				'--- a/gone.ts',
				'+++ /dev/null',
				'@@ -1,1 +0,0 @@',
				'-only',
			].join('\n'),
		);

		expect(files[0]!.path).toBe('gone.ts');
		expect(files[0]!.removed).toBe(1);
	});

	it('reports a rename as one', () => {
		const files = parsePatch(
			[
				'diff --git a/old/name.ts b/new/name.ts',
				'similarity index 96%',
				'rename from old/name.ts',
				'rename to new/name.ts',
				'--- a/old/name.ts',
				'+++ b/new/name.ts',
				'@@ -1,1 +1,1 @@',
				'-a',
				'+b',
			].join('\n'),
		);

		expect(files[0]!.path).toBe('new/name.ts');
		expect(renamedFrom(files[0]!)).toBe('old/name.ts');
	});

	it('marks a binary file rather than pretending it has lines', () => {
		const files = parsePatch(
			[
				'diff --git a/logo.png b/logo.png',
				'index 3333333..4444444 100644',
				'Binary files a/logo.png and b/logo.png differ',
			].join('\n'),
		);

		expect(files[0]!).toMatchObject({path: 'logo.png', binary: true});
		expect(files[0]!.lines).toEqual([{kind: 'note', text: 'Binary file'}]);
	});

	it('unquotes a path git escaped, and keeps one with a space', () => {
		const quoted = parsePatch(
			[
				'--- /dev/null',
				'+++ "b/src/caf\\303\\251.ts"',
				'@@ -0,0 +1 @@',
				'+x',
			].join('\n'),
		);
		expect(quoted[0]!.path).toBe('src/café.ts');

		const spaced = parsePatch(
			['--- /dev/null', '+++ b/src/two words.ts', '@@ -0,0 +1 @@', '+x'].join(
				'\n',
			),
		);
		expect(spaced[0]!.path).toBe('src/two words.ts');
	});

	it('keeps the no-newline marker as a note, off the line numbering', () => {
		const files = parsePatch(
			[
				'--- a/x',
				'+++ b/x',
				'@@ -1,1 +1,1 @@',
				'-old',
				'\\ No newline at end of file',
				'+new',
			].join('\n'),
		);

		expect(files[0]!.lines.map(line => line.kind)).toEqual([
			'hunk',
			'removed',
			'note',
			'added',
		]);
		// The note must not have consumed a number, or everything after it is off.
		expect(files[0]!.lines[3]).toMatchObject({kind: 'added', newLine: 1});
	});

	it('keeps several files apart', () => {
		const files = parsePatch(
			[
				'diff --git a/one.ts b/one.ts',
				'--- a/one.ts',
				'+++ b/one.ts',
				'@@ -1 +1 @@',
				'-a',
				'+b',
				'diff --git a/two.ts b/two.ts',
				'--- a/two.ts',
				'+++ b/two.ts',
				'@@ -5 +5 @@',
				'-c',
				'+d',
			].join('\n'),
		);

		expect(files.map(file => file.path)).toEqual(['one.ts', 'two.ts']);
		expect(files[1]!.lines[1]).toMatchObject({kind: 'removed', oldLine: 5});
	});

	it('is empty for a commit that changed nothing', () => {
		expect(parsePatch('')).toEqual([]);
	});

	/**
	 * A removed line reading `-- x` arrives in the patch as `--- x`, and an
	 * added one reading `++ x` as `+++ x` — the same shape as the `---`/`+++`
	 * path headers. Read as headers they were dropped from the rows and stopped
	 * advancing the line numbers, so everything below them was numbered one too
	 * low and a comment anchored there quoted the wrong code.
	 *
	 * Real enough to matter: a markdown rule, a YAML document separator, and
	 * `-- ` in SQL all produce it.
	 */
	it('reads a line that looks like a path header as the line it is', () => {
		const files = parsePatch(
			[
				'diff --git a/notes.md b/notes.md',
				'--- a/notes.md',
				'+++ b/notes.md',
				'@@ -1,3 +1,3 @@',
				' title',
				'--- ',
				'+++ ',
				' after',
			].join('\n'),
		);

		expect(files).toHaveLength(1);
		expect(files[0]!.path).toBe('notes.md');

		expect(
			files[0]!.lines.map(line => [line.kind, line.oldLine, line.newLine]),
		).toEqual([
			['hunk', undefined, undefined],
			['context', 1, 1],
			['removed', 2, undefined],
			['added', undefined, 2],
			// The line after them keeps its real numbers, which is what a comment
			// anchored below is resolved against.
			['context', 3, 3],
		]);
	});

	it('still reads a second file’s headers after the first file’s hunks', () => {
		const files = parsePatch(
			[
				'diff --git a/one.md b/one.md',
				'--- a/one.md',
				'+++ b/one.md',
				'@@ -1 +1 @@',
				'--- ',
				'+++ ',
				'diff --git a/two.md b/two.md',
				'--- a/two.md',
				'+++ b/two.md',
				'@@ -1 +1 @@',
				'-a',
				'+b',
			].join('\n'),
		);

		expect(files.map(file => file.path)).toEqual(['one.md', 'two.md']);
	});
});

describe('patchRows', () => {
	it('heads each file’s rows with its name', () => {
		const rows = patchRows(
			parsePatch(
				[
					'diff --git a/one.ts b/one.ts',
					'--- a/one.ts',
					'+++ b/one.ts',
					'@@ -1 +1 @@',
					'-a',
					'+b',
				].join('\n'),
			),
		);

		expect(rows.map(row => row.kind)).toEqual([
			'file',
			'hunk',
			'removed',
			'added',
		]);
		expect(rows[0]!.text).toBe('one.ts');
	});

	it('names a rename on the file row', () => {
		const rows = patchRows(
			parsePatch(
				[
					'diff --git a/old.ts b/new.ts',
					'rename from old.ts',
					'rename to new.ts',
					'--- a/old.ts',
					'+++ b/new.ts',
					'@@ -1 +1 @@',
					'-a',
					'+b',
				].join('\n'),
			),
		);

		expect(rows[0]!.text).toBe('old.ts → new.ts');
	});
});
