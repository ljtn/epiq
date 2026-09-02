import {describe, expect, it} from 'vitest';
import {
	inlineEditorGutterWidth,
	inlineEditorRowCount,
	inlineEditorRowWidth,
} from '../lib/utils/inline-editor-layout.js';

// What the inline editor is left with once the chrome around its rows is
// paid for: the ticket pane's right padding, the box's left margin, its
// border on both sides, its left padding, and the scroll box's scrollbar
// column. A row wider than this wraps, and every wrapped row pushes the ones
// below it past the box's bottom border.
const usableWidth = (maxWidth: number) => maxWidth - (1 + 1 + 2 + 1 + 1);

describe('inline editor layout', () => {
	it('keeps a row and its gutter inside the box', () => {
		for (const maxWidth of [80, 120, 197, 240]) {
			for (const rowCount of [1, 9, 99, 100, 1000]) {
				expect(
					inlineEditorGutterWidth(rowCount) +
						inlineEditorRowWidth(maxWidth, rowCount),
				).toBe(usableWidth(maxWidth));
			}
		}
	});

	it('widens the gutter once the line numbers do, and takes it from the row', () => {
		expect(inlineEditorGutterWidth(99)).toBe(5);
		expect(inlineEditorGutterWidth(100)).toBe(6);
		expect(inlineEditorGutterWidth(1000)).toBe(7);

		expect(inlineEditorRowWidth(120, 99)).toBe(109);
		expect(inlineEditorRowWidth(120, 100)).toBe(108);
	});

	it('never asks for a negative row width in a narrow terminal', () => {
		expect(inlineEditorRowWidth(10, 1)).toBe(0);
		expect(inlineEditorRowWidth(0, 1)).toBe(0);
	});
});

describe('inline editor row count', () => {
	// A 24-row terminal leaves the ticket pane 20 rows once the breadcrumb and
	// the command line have theirs. The pane spends 5 on its own chrome and 2
	// on each field below the box, so 5 rows of text are left.
	it('leaves the chrome and the fields below the room they take', () => {
		expect(inlineEditorRowCount(20, 5)).toBe(5);
		expect(inlineEditorRowCount(20, 0)).toBe(15);
		expect(inlineEditorRowCount(45, 5)).toBe(30);
	});

	it('asks for a row even in a terminal with no room for one', () => {
		expect(inlineEditorRowCount(4, 5)).toBe(1);
		expect(inlineEditorRowCount(0, 0)).toBe(1);
	});
});
