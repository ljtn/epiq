import {describe, expect, it} from 'vitest';
import {SelectedLineRange} from '@pierre/diffs/react';
import {
	dedent,
	encodeDiffCommentMarker,
	extractSnippet,
	findDiffCommentsForFile,
	formatSelectionLabel,
	parseDiffCommentMeta,
	stripDiffCommentMarker,
} from './IssueCommits';
import {GuiComment, GuiCommitDiffFile} from '../lib/gui-state.model';

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

describe('dedent', () => {
	it('strips the common leading whitespace shared by every non-blank line', () => {
		const snippet = '\t\t\tfirst\n\t\t\tsecond\n\t\t\t\tindented further';

		expect(dedent(snippet)).toBe('first\nsecond\n\tindented further');
	});

	it('ignores blank lines when computing the common indent', () => {
		const snippet = '\t\tfirst\n\n\t\tsecond';

		expect(dedent(snippet)).toBe('first\n\nsecond');
	});

	it('leaves an already-flush snippet unchanged', () => {
		expect(dedent('first\nsecond')).toBe('first\nsecond');
	});

	it('leaves a snippet of only blank lines unchanged', () => {
		expect(dedent('\n\n')).toBe('\n\n');
	});
});

const guiComment = (
	body: string,
	overrides: Partial<GuiComment> = {},
): GuiComment => ({
	id: 'c1',
	issueId: 'issue1',
	body,
	author: {id: 'u1', name: 'Ada', color: '#fff'},
	createdAt: 1_700_000_000_000,
	...overrides,
});

describe('encodeDiffCommentMarker / parseDiffCommentMeta', () => {
	it('round-trips through a full comment body', () => {
		const meta = {
			filePath: 'source/a.ts',
			start: 2,
			side: 'additions' as const,
			end: 4,
			endSide: 'additions' as const,
			note: 'worth a look',
		};

		const body = [
			'worth a look',
			'',
			encodeDiffCommentMarker(meta),
			'`source/a.ts` lines 2-4 (added)',
			'```',
			'snippet',
			'```',
		].join('\n');

		expect(parseDiffCommentMeta(body)).toEqual(meta);
	});

	it('returns null for a plain comment with no marker', () => {
		expect(parseDiffCommentMeta('just a regular comment')).toBeNull();
	});

	it('returns null for malformed JSON inside the marker', () => {
		expect(
			parseDiffCommentMeta('<!-- epiq-diff-comment:{not json} -->'),
		).toBeNull();
	});

	// Regression guard: `-->` inside a note used to terminate the HTML-comment
	// marker early, truncating the JSON (annotation silently lost) and leaving
	// the remainder rendered as visible garbage in the comment.
	it('round-trips a note containing an HTML comment terminator', () => {
		const meta = {
			filePath: 'source/a.ts',
			start: 1,
			side: 'additions' as const,
			end: 2,
			endSide: 'additions' as const,
			note: 'this --> that',
		};

		const body = `this --> that\n\n${encodeDiffCommentMarker(meta)}\nrest`;

		expect(parseDiffCommentMeta(body)).toEqual(meta);
		expect(stripDiffCommentMarker(body)).toBe('this --> that\n\nrest');
	});

	it('returns null when a required field is missing', () => {
		const incomplete = JSON.stringify({filePath: 'a.ts', start: 1});

		expect(
			parseDiffCommentMeta(`<!-- epiq-diff-comment:${incomplete} -->`),
		).toBeNull();
	});
});

// Regression guard: react-markdown does not drop a raw `<!-- ... -->` HTML
// comment on its own (it renders as literal text without rehype-raw) — the
// marker leaking into a rendered comment was caught live and is exactly what
// this strips before the body ever reaches the markdown renderer.
describe('stripDiffCommentMarker', () => {
	it('removes the marker and its trailing newline', () => {
		const meta = {
			filePath: 'a.ts',
			start: 1,
			side: 'additions' as const,
			end: 1,
			endSide: 'additions' as const,
			note: 'note',
		};
		const body = `note\n\n${encodeDiffCommentMarker(
			meta,
		)}\nrest of the comment`;

		expect(stripDiffCommentMarker(body)).toBe('note\n\nrest of the comment');
	});

	it('leaves a plain comment with no marker unchanged', () => {
		expect(stripDiffCommentMarker('just a regular comment')).toBe(
			'just a regular comment',
		);
	});
});

describe('findDiffCommentsForFile', () => {
	const meta = {
		filePath: 'source/a.ts',
		start: 1,
		side: 'additions' as const,
		end: 1,
		endSide: 'additions' as const,
		note: '',
	};

	it('matches comments whose marker targets the given file', () => {
		const comment = guiComment(`${encodeDiffCommentMarker(meta)}\ntext`);

		expect(findDiffCommentsForFile([comment], 'source/a.ts')).toEqual([
			{comment, meta},
		]);
	});

	it('excludes comments targeting a different file', () => {
		const comment = guiComment(encodeDiffCommentMarker(meta));

		expect(findDiffCommentsForFile([comment], 'source/other.ts')).toEqual([]);
	});

	it('excludes plain (non-diff) comments', () => {
		const comment = guiComment('just a regular comment');

		expect(findDiffCommentsForFile([comment], 'source/a.ts')).toEqual([]);
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
