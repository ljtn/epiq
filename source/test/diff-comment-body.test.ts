import {describe, expect, it} from 'vitest';

import {
	parsePatch,
	patchRows,
	selectionFromRows,
} from '../lib/commits/patch-parse.js';
import {
	buildDiffCommentBody,
	extractSnippet,
	parseDiffCommentMeta,
} from '../lib/utils/diff-comment.js';

// A comment made in the TUI's pager and one made in the GUI's diff have to be
// the same comment. They are built from different things — the TUI has the
// patch's rows, the GUI has both whole revisions of the file — so the only
// thing keeping them identical is that both end at buildDiffCommentBody with
// the same selection. This is where that is checked.

const AFTER = [
	'const keep = 1;',
	'const fresh = 9;',
	'const also = 3;',
	'const tail = 4;',
].join('\n');

const BEFORE = [
	'const keep = 1;',
	'const drop = 2;',
	'const also = 3;',
	'const tail = 4;',
].join('\n');

const PATCH = [
	'diff --git a/thing.ts b/thing.ts',
	'index 1111111..2222222 100644',
	'--- a/thing.ts',
	'+++ b/thing.ts',
	'@@ -1,4 +1,4 @@',
	' const keep = 1;',
	'-const drop = 2;',
	'+const fresh = 9;',
	' const also = 3;',
	' const tail = 4;',
].join('\n');

const SHA = 'abc1234';

const rows = patchRows(parsePatch(PATCH));

// The row index of a given new-revision line, as the pager's cursor would sit.
const rowAtNewLine = (line: number) =>
	rows.findIndex(row => 'newLine' in row && row.newLine === line);

const fromTui = (fromLine: number, toLine: number, note: string) => {
	const selection = selectionFromRows(
		rows,
		rowAtNewLine(fromLine),
		rowAtNewLine(toLine),
	);
	if (!selection.ok) throw new Error(selection.reason);

	return buildDiffCommentBody({
		filePath: selection.value.filePath,
		start: selection.value.start,
		end: selection.value.end,
		side: 'additions',
		endSide: 'additions',
		note,
		sha: SHA,
		snippet: selection.value.snippet,
	});
};

const fromGui = (start: number, end: number, note: string) =>
	buildDiffCommentBody({
		filePath: 'thing.ts',
		start,
		end,
		side: 'additions',
		endSide: 'additions',
		note,
		sha: SHA,
		snippet: extractSnippet(
			{before: BEFORE, after: AFTER},
			{start, end, side: 'additions', endSide: 'additions'},
		),
	});

describe('a diff comment written in the TUI and one written in the GUI', () => {
	it('are the same body, for one line', () => {
		expect(fromTui(2, 2, 'this looks wrong')).toBe(
			fromGui(2, 2, 'this looks wrong'),
		);
	});

	it('are the same body, for a range that spans a removed line', () => {
		// New-revision lines 1 to 3 have a removed line between them in the
		// patch; the GUI slices them straight out of the file and never sees it.
		expect(fromTui(1, 3, 'the whole block')).toBe(
			fromGui(1, 3, 'the whole block'),
		);
	});

	it('are the same body with no note at all', () => {
		expect(fromTui(2, 2, '')).toBe(fromGui(2, 2, ''));
	});

	it('carry a marker the other surface can read back', () => {
		const meta = parseDiffCommentMeta(fromTui(1, 3, 'look here'));

		expect(meta).toEqual({
			filePath: 'thing.ts',
			start: 1,
			end: 3,
			side: 'additions',
			endSide: 'additions',
			note: 'look here',
			sha: SHA,
		});
	});
});

describe('what the pager refuses to anchor', () => {
	it('a removed line, which is a position in the old revision only', () => {
		const removed = rows.findIndex(row => row.kind === 'removed');
		const result = selectionFromRows(rows, removed, removed);

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.reason).toMatch(/new side/);
	});

	it('a file header, which is not a line of anything', () => {
		const result = selectionFromRows(rows, 0, 0);

		expect(result.ok).toBe(false);
	});

	it('a range crossing into another file', () => {
		const twoFiles = patchRows(
			parsePatch(
				[
					'diff --git a/one.ts b/one.ts',
					'--- a/one.ts',
					'+++ b/one.ts',
					'@@ -1 +1,2 @@',
					' a',
					'+b',
					'diff --git a/two.ts b/two.ts',
					'--- a/two.ts',
					'+++ b/two.ts',
					'@@ -1 +1,2 @@',
					' c',
					'+d',
				].join('\n'),
			),
		);

		const first = twoFiles.findIndex(row => row.kind === 'context');
		const last = twoFiles.length - 1;

		const result = selectionFromRows(twoFiles, first, last);

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.reason).toMatch(/one file/);
	});

	it('a range crossing a hunk boundary, where the patch omits the lines between', () => {
		const twoHunks = patchRows(
			parsePatch(
				[
					'diff --git a/one.ts b/one.ts',
					'--- a/one.ts',
					'+++ b/one.ts',
					'@@ -1,2 +1,2 @@',
					' a',
					'+b',
					'@@ -40,2 +40,2 @@',
					' y',
					'+z',
				].join('\n'),
			),
		);

		const first = twoHunks.findIndex(row => row.kind === 'context');
		const last = twoHunks.length - 1;

		const result = selectionFromRows(twoHunks, first, last);

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.reason).toMatch(/one hunk/);
	});
});
