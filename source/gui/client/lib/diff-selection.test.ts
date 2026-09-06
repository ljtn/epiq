import {describe, expect, it} from 'vitest';
import {SelectedLineRange} from '@pierre/diffs/react';
import {
	dedent,
	diffLocationFromMeta,
	extractSnippet,
	findDiffCommentsForFile,
	readDiffLocationParams,
	writeDiffLocationParams,
} from './diff-selection';
import {
	encodeDiffCommentMarker,
	extractCommentLead,
	extractCommentSnippet,
	formatSelectionLabel,
	parseDiffCommentMeta,
	stripDiffCommentMarker,
	withDiffCommentNote,
} from '../../../lib/utils/diff-comment.js';
import {GuiComment, GuiCommitDiffFile} from './gui-state.model';

const file: GuiCommitDiffFile = {
	path: 'source/a.ts',
	before: 'before one\nbefore two\nbefore three\nbefore four',
	after: 'after one\nafter two\nafter three\nafter four',
	insertions: 4,
	deletions: 4,
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

// A comment's file/line reference links back into the diff, so the location
// has to survive a round trip through the URL — that is what makes the link
// reloadable and shareable rather than a transient bit of state.
describe('writeDiffLocationParams / readDiffLocationParams', () => {
	const location = {
		sha: 'abc123',
		filePath: 'source/gui/client/App.tsx',
		start: 12,
		end: 18,
		side: 'deletions' as const,
		endSide: 'additions' as const,
	};

	it('round-trips a location through URL params', () => {
		const params = new URLSearchParams();
		writeDiffLocationParams(params, location);

		expect(readDiffLocationParams(params)).toEqual(location);
	});

	it('survives being serialized into a query string', () => {
		const params = new URLSearchParams();
		writeDiffLocationParams(params, location);

		expect(
			readDiffLocationParams(new URLSearchParams(params.toString())),
		).toEqual(location);
	});

	it('keeps unrelated params untouched', () => {
		const params = new URLSearchParams({tab: 'code'});
		writeDiffLocationParams(params, location);

		expect(params.get('tab')).toBe('code');
	});

	it('reads null when no location is present', () => {
		expect(
			readDiffLocationParams(new URLSearchParams({tab: 'code'})),
		).toBeNull();
	});

	it('reads null when the range is not numeric', () => {
		const params = new URLSearchParams();
		writeDiffLocationParams(params, location);
		params.set('from', 'not-a-number');

		expect(readDiffLocationParams(params)).toBeNull();
	});

	it('reads null when a side is not a known selection side', () => {
		const params = new URLSearchParams();
		writeDiffLocationParams(params, location);
		params.set('side', 'sideways');

		expect(readDiffLocationParams(params)).toBeNull();
	});
});

describe('extractCommentSnippet', () => {
	const body = [
		'a note',
		'',
		'`source/a.ts` lines 2-3 (added)',
		'```',
		'const a = 1;',
		'const b = 2;',
		'```',
	].join('\n');

	it('pulls the fenced snippet back out verbatim', () => {
		expect(extractCommentSnippet(body)).toBe('const a = 1;\nconst b = 2;');
	});

	it('preserves blank lines inside the snippet', () => {
		const withBlank = ['```', 'first', '', 'third', '```'].join('\n');

		expect(extractCommentSnippet(withBlank)).toBe('first\n\nthird');
	});

	it('returns null for a comment with no fenced block', () => {
		expect(extractCommentSnippet('just a regular comment')).toBeNull();
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

describe('issueRef', () => {
	const meta = {
		filePath: 'source/a.ts',
		start: 2,
		side: 'additions' as const,
		end: 3,
		endSide: 'additions' as const,
		note: 'filed',
		sha: 'abc123',
		issueRef: 'ABCDEFG',
	};

	it('round-trips through the marker and into the location', () => {
		expect(parseDiffCommentMeta(encodeDiffCommentMarker(meta))).toEqual(meta);
		expect(diffLocationFromMeta(meta)?.issueRef).toBe('ABCDEFG');
	});

	it('is left off the location when the marker has none', () => {
		const {issueRef: _, ...own} = meta;

		expect(diffLocationFromMeta(own)).not.toHaveProperty('issueRef');
	});

	it('rejects a marker whose issueRef is not a string', () => {
		expect(
			parseDiffCommentMeta(
				`<!-- epiq-diff-comment:${JSON.stringify({...meta, issueRef: 7})} -->`,
			),
		).toBeNull();
	});
});

describe('withDiffCommentNote', () => {
	const meta = {
		filePath: 'source/a.ts',
		start: 2,
		side: 'additions' as const,
		end: 3,
		endSide: 'additions' as const,
		note: 'old note',
		sha: 'abc123',
	};
	const body = [
		'old note',
		'',
		encodeDiffCommentMarker(meta),
		'`source/a.ts` lines 2–3 (added)',
		'```',
		'after two\nafter three',
		'```',
	].join('\n');

	it('replaces the note in both the text and the marker, keeping the rest', () => {
		const next = withDiffCommentNote(body, 'new note');

		expect(next).not.toBeNull();
		expect(next!.startsWith('new note\n\n')).toBe(true);
		expect(parseDiffCommentMeta(next!)).toEqual({...meta, note: 'new note'});
		expect(extractCommentSnippet(next!)).toBe('after two\nafter three');
		expect(next).not.toContain('old note');
	});

	it('drops the leading text when the note is emptied', () => {
		const next = withDiffCommentNote(body, '  ');

		expect(next!.startsWith('<!-- epiq-diff-comment:')).toBe(true);
		expect(parseDiffCommentMeta(next!)?.note).toBe('');
		expect(extractCommentSnippet(next!)).toBe('after two\nafter three');
	});

	it('is null for a body without a marker', () => {
		expect(withDiffCommentNote('just words', 'note')).toBeNull();
	});
});

describe('findDiffCommentsForFile', () => {
	it('leaves out a deleted comment, so its annotation goes with it', () => {
		const marker = encodeDiffCommentMarker({
			filePath: 'source/a.ts',
			start: 1,
			side: 'additions',
			end: 1,
			endSide: 'additions',
			note: '',
		});
		const comment = {
			id: 'c1',
			issueId: 'i1',
			body: marker,
			author: {id: 'u', name: 'u'},
			createdAt: 0,
		} as GuiComment;

		expect(findDiffCommentsForFile([comment], 'source/a.ts')).toHaveLength(1);
		expect(
			findDiffCommentsForFile([{...comment, isDeleted: true}], 'source/a.ts'),
		).toHaveLength(0);
	});
});

describe('extractCommentLead', () => {
	const marker = encodeDiffCommentMarker({
		filePath: 'source/a.ts',
		start: 2,
		side: 'additions',
		end: 3,
		endSide: 'additions',
		note: 'as written',
	});
	const tail = ['`source/a.ts` lines 2–3 (added)', '```', 'code', '```'];

	it('is the text before the caption and snippet, not the marker copy', () => {
		const body = ['as written', '', marker, ...tail].join('\n');
		expect(extractCommentLead(body)).toBe('as written');

		const edited = [
			'as written',
			'',
			'and more, by hand',
			'',
			marker,
			...tail,
		].join('\n');
		expect(extractCommentLead(edited)).toBe('as written\n\nand more, by hand');
	});

	it('is empty for a body that is only the quote', () => {
		expect(extractCommentLead([marker, ...tail].join('\n'))).toBe('');
	});

	it('keeps a caption-shaped line that is part of the text', () => {
		const body = ['see `source/b.ts` too', '', marker, ...tail].join('\n');
		expect(extractCommentLead(body)).toBe('see `source/b.ts` too');
	});
});
