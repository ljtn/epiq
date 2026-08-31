import {describe, expect, it} from 'vitest';
import {encodeDiffCommentMarker} from '../lib/utils/diff-comment.js';
import {
	classifyRows,
	collapseImages,
	inlineSpans,
	renderMarkdownLines,
	wrapText,
} from '../lib/utils/markdown-lite.js';

describe('wrapText', () => {
	it('breaks at spaces and never past the width', () => {
		expect(wrapText('the quick brown fox jumps', 10)).toEqual([
			'the quick',
			'brown fox',
			'jumps',
		]);
	});

	it('cuts a word longer than the width', () => {
		expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
	});

	it('gives one empty line for empty text', () => {
		expect(wrapText('   ', 10)).toEqual(['']);
	});
});

describe('inlineSpans', () => {
	it('marks backtick pairs as code', () => {
		expect(inlineSpans('run `npm test` now')).toEqual([
			{text: 'run '},
			{text: 'npm test', code: true},
			{text: ' now'},
		]);
	});

	it('leaves an unbalanced backtick alone', () => {
		expect(inlineSpans('a ` b')).toEqual([{text: 'a ` b'}]);
	});
});

describe('classifyRows', () => {
	it('keeps one line per row and styles fences, headings and the marker', () => {
		const marker = encodeDiffCommentMarker({
			filePath: 'a.ts',
			start: 3,
			side: 'additions',
			end: 5,
			endSide: 'additions',
			note: '',
		});
		const rows = ['# Title', '', marker, '```', 'code', '```', 'after'];

		expect(classifyRows(rows).map(line => line.kind)).toEqual([
			'heading',
			'blank',
			'caption',
			'fence',
			'code',
			'fence',
			'text',
		]);
		expect(classifyRows(rows)[2]).toEqual({
			kind: 'caption',
			text: 'a.ts lines 3-5 (added)',
		});
	});
});

describe('collapseImages', () => {
	it('names the image instead of printing its url', () => {
		expect(collapseImages('before ![a shot](/media/abc.png) after')).toBe(
			'before [image: a shot] after',
		);
	});

	it('falls back to a bare marker when there is no alt text', () => {
		expect(collapseImages('![](/media/abc.png)')).toBe('[image]');
	});

	it('leaves an ordinary link alone', () => {
		expect(collapseImages('[a shot](/media/abc.png)')).toBe(
			'[a shot](/media/abc.png)',
		);
	});
});

describe('classifyRows', () => {
	it('collapses an image row to one line, keeping rows aligned', () => {
		expect(classifyRows(['![a shot](/media/abc.png)'])).toEqual([
			{kind: 'text', spans: [{text: '[image: a shot]'}]},
		]);
	});

	it('leaves image markdown inside a fence as the code it is', () => {
		expect(classifyRows(['```', '![a shot](/media/abc.png)', '```'])).toEqual([
			{kind: 'fence'},
			{kind: 'code', text: '![a shot](/media/abc.png)'},
			{kind: 'fence'},
		]);
	});
});

describe('renderMarkdownLines', () => {
	it('expands tabs so a code line measures as wide as it draws', () => {
		const md = '```\n\tif (x) {\n\t\treturn;\n```';

		expect(renderMarkdownLines(md, 40)).toEqual([
			{kind: 'code', text: '    if (x) {'},
			{kind: 'code', text: '        return;'},
		]);
	});

	it('wraps a tab-indented snippet line by its drawn width', () => {
		const marker = encodeDiffCommentMarker({
			filePath: 'a.ts',
			start: 7,
			side: 'additions',
			end: 7,
			endSide: 'additions',
			note: '',
		});
		const md = [
			marker,
			'`a.ts` line 7 (added)',
			'```',
			'\t\tabcdef',
			'```',
		].join('\n');

		// Width 20, gutter "7 │ " is 4: 16 columns per row, the line is 14.
		expect(renderMarkdownLines(md, 20)).toEqual([
			{kind: 'caption', text: 'a.ts line 7 (added)'},
			{kind: 'code', text: '        abcdef', number: 7},
		]);
	});

	it('wraps paragraphs, drops fence rows and collapses blank runs', () => {
		const md = 'one two three four\n\n\n```\nlet x = 1;\n```\n';

		expect(renderMarkdownLines(md, 9)).toEqual([
			{kind: 'text', spans: [{text: 'one two'}]},
			{kind: 'text', spans: [{text: 'three'}]},
			{kind: 'text', spans: [{text: 'four'}]},
			{kind: 'blank'},
			{kind: 'code', text: 'let x = 1'},
			{kind: 'code', text: ';'},
		]);
	});

	it('renders a diff-linked body as lead, caption and numbered snippet', () => {
		const marker = encodeDiffCommentMarker({
			filePath: 'src/a.ts',
			start: 12,
			side: 'additions',
			end: 13,
			endSide: 'additions',
			note: 'looks off',
			issueRef: 'ABCDEFG',
		});
		const md = [
			'looks off',
			'',
			marker,
			'`src/a.ts` lines 12-13 (added)',
			'```',
			'const a = 1;',
			'const b = 2;',
			'```',
		].join('\n');

		expect(renderMarkdownLines(md, 40)).toEqual([
			{kind: 'text', spans: [{text: 'looks off'}]},
			{kind: 'blank'},
			{kind: 'caption', text: 'ABCDEFG · src/a.ts lines 12-13 (added)'},
			{kind: 'code', text: 'const a = 1;', number: 12},
			{kind: 'code', text: 'const b = 2;', number: 13},
		]);
	});

	it('leaves numbers off a snippet that spans both sides', () => {
		const marker = encodeDiffCommentMarker({
			filePath: 'a.ts',
			start: 1,
			side: 'deletions',
			end: 2,
			endSide: 'additions',
			note: '',
		});
		const md = [
			marker,
			'`a.ts` lines 1-2 (added)',
			'```',
			'x',
			'y',
			'```',
		].join('\n');

		expect(renderMarkdownLines(md, 40)).toEqual([
			{kind: 'caption', text: 'a.ts lines 1-2 (added)'},
			{kind: 'code', text: 'x', number: undefined},
			{kind: 'code', text: 'y', number: undefined},
		]);
	});
});
