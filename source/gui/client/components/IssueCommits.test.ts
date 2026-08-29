import {describe, expect, it} from 'vitest';
import {SelectedLineRange} from '@pierre/diffs/react';
import {extractSnippet, formatSelectionLabel} from './IssueCommits';
import {GuiCommitDiffFile} from '../lib/gui-state.model';

const file: GuiCommitDiffFile = {
	path: 'source/a.ts',
	before: 'before one\nbefore two\nbefore three\nbefore four',
	after: 'after one\nafter two\nafter three\nafter four',
};

describe('extractSnippet', () => {
	it('slices the added side when side and endSide are both additions', () => {
		const range: SelectedLineRange = {start: 2, end: 3, side: 'additions'};

		expect(extractSnippet(file, range)).toBe('after two\nafter three');
	});

	it('slices the removed side when side is deletions', () => {
		const range: SelectedLineRange = {start: 1, end: 2, side: 'deletions'};

		expect(extractSnippet(file, range)).toBe('before one\nbefore two');
	});

	it('defaults endSide to side when endSide is omitted', () => {
		const range: SelectedLineRange = {start: 4, end: 4, side: 'additions'};

		expect(extractSnippet(file, range)).toBe('after four');
	});

	it('quotes both halves when a selection spans deletions into additions', () => {
		const range: SelectedLineRange = {
			start: 3,
			side: 'deletions',
			end: 2,
			endSide: 'additions',
		};

		expect(extractSnippet(file, range)).toBe(
			'before three\nbefore four\nafter one\nafter two',
		);
	});
});

describe('formatSelectionLabel', () => {
	it('labels a single selected line as singular', () => {
		expect(formatSelectionLabel({start: 5, end: 5, side: 'additions'})).toBe(
			'line 5 (added)',
		);
	});

	it('labels a multi-line selection as a range', () => {
		expect(formatSelectionLabel({start: 5, end: 8, side: 'additions'})).toBe(
			'lines 5-8 (added)',
		);
	});

	it('labels a deletions-side selection as removed', () => {
		expect(formatSelectionLabel({start: 1, end: 2, side: 'deletions'})).toBe(
			'lines 1-2 (removed)',
		);
	});

	it('labels a mixed-side selection by its end side', () => {
		const range: SelectedLineRange = {
			start: 1,
			side: 'deletions',
			end: 2,
			endSide: 'additions',
		};

		expect(formatSelectionLabel(range)).toBe('lines 1-2 (added)');
	});
});
