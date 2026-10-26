import {sanitizeInlineText} from './string.utils.js';

// A description flattened to a couple of lines for a hover preview. Blocks,
// images and tables are dropped, not shrunk.

// Fenced blocks dropped whole, with either fence character.
const FENCED_BLOCK = /^(```|~~~)[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm;

// An unclosed fence drops everything after it.
const UNCLOSED_FENCE = /^(?:```|~~~)[\s\S]*$/m;

// A table's ruling row carries nothing but the shape of the table.
const TABLE_RULE =
	/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm;

// Table bars become spaces, only on rows that open with one, so a shell pipe
// survives.
const TABLE_ROW = /^[ \t]*\|.*$/gm;

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

// Emphasis and code marks, dropped unpaired: half-written text is often
// unbalanced.
const INLINE_MARKS = /[*`~]/g;

// Underscores only at a word's edge, so `snake_case_name` survives.
const EMPHASIS_UNDERSCORE = /(?<![0-9A-Za-z])_|_(?![0-9A-Za-z])/g;

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
			.replace(TABLE_ROW, row => row.replaceAll('|', ' '))
			.replace(ROW_PREFIX, '')
			.replace(INLINE_MARKS, '')
			.replace(EMPHASIS_UNDERSCORE, ''),
	);

// Back up to a word boundary, but never past half the excerpt.
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
