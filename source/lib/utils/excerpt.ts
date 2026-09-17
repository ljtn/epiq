import {sanitizeInlineText} from './string.utils.js';

// A description flattened to the couple of lines a hover preview can hold.
//
// Not a markdown renderer: a preview is prose about what the ticket is, so
// everything that only means something with room to lay it out — a fenced
// block, an image, a table's pipes — is dropped rather than shrunk, and the
// rest becomes the words it was written as.

// Dropped whole, contents and all. A code block in a two-line card is the
// two lines spent on something unreadable at that size. Both fence characters
// markdown allows, since a description is as likely to carry one as the other.
const FENCED_BLOCK = /^(```|~~~)[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm;

// A description still being written can hold a fence that was opened and not
// yet closed; everything after it is inside a code block that has no end, so
// it goes the same way as a closed one.
const UNCLOSED_FENCE = /^(?:```|~~~)[\s\S]*$/m;

// A table's ruling row carries nothing but the shape of the table.
const TABLE_RULE =
	/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm;

// What is left of a table once its rule is gone: cells, and the bars that laid
// them out. The bars become the spaces between the words, which is what a row
// of a table reads as on one line.
const TABLE_BARS = /\|/g;

// Before the link rule below, which would otherwise keep an image's alt text
// as if it were prose.
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;

const LINK = /\[([^\]]*)\]\([^)]*\)/g;

// Leading row furniture: heading hashes, quote carets, list bullets and
// numbers, and the indentation any of them may be nested behind.
const ROW_PREFIX = /^[ \t]*(?:[#>]+[ \t]*|[-*+][ \t]+|\d+[.)][ \t]+)/gm;

// A rule drawn as ---, *** or ___ on a row of its own; nothing survives it
// but the blank line it becomes.
const THEMATIC_BREAK = /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm;

// The characters that carry emphasis and inline code. Dropped unconditionally
// rather than matched in pairs: an unbalanced one is far likelier in a
// half-written description than a literal asterisk is, and a preview that
// keeps the word and loses the styling is right either way.
const INLINE_MARKS = /[*_`~]/g;

const flatten = (markdown: string): string =>
	sanitizeInlineText(
		markdown
			.replace(FENCED_BLOCK, ' ')
			.replace(UNCLOSED_FENCE, ' ')
			.replace(IMAGE, ' ')
			.replace(LINK, '$1')
			.replace(THEMATIC_BREAK, ' ')
			// Before ROW_PREFIX, whose bullet rule would otherwise read a rule
			// row's leading dashes as a list marker and leave the rest behind.
			.replace(TABLE_RULE, ' ')
			.replace(TABLE_BARS, ' ')
			.replace(ROW_PREFIX, '')
			.replace(INLINE_MARKS, ''),
	);

// Back up to a word boundary, but never past half the excerpt: a description
// opening with one very long token would otherwise cut back to almost nothing,
// and half a word read at a glance beats two words and empty space.
const WORD_BOUNDARY_REACH = 0.5;

/**
 * `markdown` as one line of plain prose, at most `limit` characters including
 * the ellipsis that says it was cut.
 */
export const plainExcerpt = (markdown: string, limit: number): string => {
	if (limit <= 0) return '';

	const flat = flatten(markdown);
	if (flat.length <= limit) return flat;

	const ELLIPSIS = '…';
	const budget = limit - ELLIPSIS.length;
	if (budget <= 0) return ELLIPSIS.slice(0, limit);

	const cut = flat.slice(0, budget);
	const lastSpace = cut.lastIndexOf(' ');

	const kept =
		lastSpace >= budget * WORD_BOUNDARY_REACH ? cut.slice(0, lastSpace) : cut;

	return `${kept.trimEnd()}${ELLIPSIS}`;
};
