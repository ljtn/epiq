import {describe, expect, it} from 'vitest';
import {encodeDiffCommentMarker} from '../lib/utils/diff-comment.js';
import {
	classifyRows,
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

describe('renderMarkdownLines', () => {
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
