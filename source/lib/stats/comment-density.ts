// How much of what the ticket wrote is prose.
//
// Two things this deliberately is not. It is not a lexer: a diff at
// --unified=0 hands over changed lines with no context, so there is no way to
// know whether an added line sits inside a block comment somebody else opened,
// and every line is classified on its own. And it is not a target — the number
// alone is trivially gamed and says nothing, which is why it is only ever
// shown beside the repository's own share for the same language.

import {
	commentSyntaxOf,
	CommentSyntax,
	isGeneratedPath,
	languageOf,
} from './file-kinds.js';
import {CommentDensity} from './issue-stats.model.js';
import {TicketPatch} from './patch-scan.js';

export type LineKind = 'blank' | 'comment' | 'code';

const TODO = /\b(TODO|FIXME|HACK|XXX)\b/;

// Conservative on purpose: a false "you left code commented out" is worse
// than a miss, since the whole value of the flag is that it is rare.
const LOOKS_LIKE_CODE =
	/[;{}]\s*$|^\s*(const|let|var|function|def|class|if|for|while|return|import|export|await|print)\b.*[=(]/;

export const classifyLine = (
	text: string,
	syntax: CommentSyntax | null,
): LineKind => {
	const trimmed = text.trim();

	if (trimmed === '') return 'blank';
	// An unlisted language: count it as code rather than guess at `//` and
	// report prose that may not be there.
	if (!syntax) return 'code';

	if (syntax.line.some(token => trimmed.startsWith(token))) return 'comment';
	if (syntax.block.some(([open]) => trimmed.startsWith(open))) return 'comment';

	// The middle and end of a C-style block, which is where most of a long
	// comment's lines actually are.
	if (
		syntax.block.some(([open]) => open === '/*') &&
		(trimmed.startsWith('*') || trimmed.startsWith('*/'))
	) {
		return 'comment';
	}

	return 'code';
};

const stripMarkers = (text: string, syntax: CommentSyntax): string => {
	let stripped = text.trim();

	for (const token of [...syntax.line, ...syntax.block.flat(), '*']) {
		if (stripped.startsWith(token)) {
			stripped = stripped.slice(token.length).trim();
			break;
		}
	}

	return stripped;
};

export const deriveCommentDensity = ({
	patch,
	repoShareByLanguage,
}: {
	patch: TicketPatch;
	repoShareByLanguage: Map<string, number> | null;
}): CommentDensity => {
	const byName = new Map<string, {comment: number; code: number}>();

	let commentLines = 0;
	let codeLines = 0;
	let blankLines = 0;
	let todoLinesAdded = 0;
	let todoLinesRemoved = 0;
	let commentedOutCodeLines = 0;

	for (const file of patch.files) {
		if (file.binary || isGeneratedPath(file.path)) continue;

		const syntax = commentSyntaxOf(file.path);

		// A language with no comment syntax at all — JSON is the one that turns
		// up — can only ever report 0%, against a repo baseline of 0%. Left in,
		// it is a row that looks like a finding and is a property of the file
		// format.
		if (!syntax || (syntax.line.length === 0 && syntax.block.length === 0)) {
			continue;
		}

		const name = languageOf(file.path);
		const entry = byName.get(name) ?? {comment: 0, code: 0};

		for (const {text} of file.added) {
			const kind = classifyLine(text, syntax);

			if (TODO.test(text)) todoLinesAdded++;

			if (kind === 'blank') {
				blankLines++;
				continue;
			}

			if (kind === 'comment') {
				commentLines++;
				entry.comment++;

				if (syntax && LOOKS_LIKE_CODE.test(stripMarkers(text, syntax))) {
					commentedOutCodeLines++;
				}

				continue;
			}

			codeLines++;
			entry.code++;
		}

		// A TODO that leaves is as worth knowing as one that arrives; either
		// alone reads as the opposite of what it is on a ticket that did both.
		for (const {text} of file.removedLines) {
			if (TODO.test(text)) todoLinesRemoved++;
		}

		byName.set(name, entry);
	}

	const nonBlank = commentLines + codeLines;

	return {
		byLanguage: [...byName.entries()]
			.map(([name, counts]) => ({
				name,
				commentLines: counts.comment,
				codeLines: counts.code,
				share:
					counts.comment + counts.code === 0
						? 0
						: counts.comment / (counts.comment + counts.code),
				repoShare: repoShareByLanguage?.get(name) ?? null,
			}))
			.sort(
				(a, b) => b.commentLines + b.codeLines - (a.commentLines + a.codeLines),
			),
		commentLines,
		codeLines,
		blankLines,
		share: nonBlank === 0 ? 0 : commentLines / nonBlank,
		todoLinesAdded,
		todoLinesRemoved,
		commentedOutCodeLines,
	};
};
