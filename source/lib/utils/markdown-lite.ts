import {
	extractCommentLead,
	extractCommentSnippet,
	formatDiffCaption,
	parseDiffCommentMeta,
	stripDiffCommentMarker,
} from './diff-comment.js';

// The little markdown a terminal can honour: paragraphs, headings, fenced
// code, inline code, and the diff marker rendered as its caption. Everything
// else is left as the text it is.

export type Span = {text: string; code?: boolean};

export type RenderedLine =
	| {kind: 'text'; spans: Span[]}
	| {kind: 'heading'; spans: Span[]}
	| {kind: 'code'; text: string; number?: number}
	| {kind: 'fence'}
	| {kind: 'caption'; text: string}
	| {kind: 'blank'};

// Word wrap; a word longer than the width is cut rather than overflowing.
export const wrapText = (text: string, width: number): string[] => {
	const safeWidth = Math.max(1, Math.floor(width));
	const words = text.split(/\s+/).filter(Boolean);
	if (words.length === 0) return [''];

	const lines: string[] = [];
	let current = '';

	for (const word of words) {
		let rest = word;

		while (rest.length > safeWidth) {
			if (current) {
				lines.push(current);
				current = '';
			}
			lines.push(rest.slice(0, safeWidth));
			rest = rest.slice(safeWidth);
		}

		if (!current) {
			current = rest;
		} else if (current.length + 1 + rest.length <= safeWidth) {
			current = `${current} ${rest}`;
		} else {
			lines.push(current);
			current = rest;
		}
	}

	if (current) lines.push(current);

	return lines;
};

// Backtick pairs become code spans; an unbalanced backtick leaves the line
// as plain text rather than guessing where the code was meant to end.
export const inlineSpans = (text: string): Span[] => {
	const parts = text.split('`');
	if (parts.length % 2 === 0) return [{text}];

	return parts
		.map((part, index) =>
			index % 2 === 1 ? {text: part, code: true} : {text: part},
		)
		.filter(span => span.text.length > 0);
};

const spansToText = (spans: Span[]): string =>
	spans.map(span => (span.code ? `\`${span.text}\`` : span.text)).join('');

// A terminal advances a tab to the next tab stop while string measuring
// counts it as nothing, so a tab-indented line looks narrower than it draws
// and overflows the box. Spaces measure as they draw.
const TAB_WIDTH = 4;

export const expandTabs = (text: string): string =>
	text.replace(/\r$/, '').replaceAll('\t', ' '.repeat(TAB_WIDTH));

// One rendered line per source row, nothing wrapped or dropped: what a
// line-numbered view needs, since its rows have to keep lining up with the
// text they came from. The marker row becomes its caption; fence rows stay.
export const classifyRows = (rawRows: string[]): RenderedLine[] => {
	let inFence = false;

	return rawRows.map(expandTabs).map((row): RenderedLine => {
		if (/^\s*```/.test(row)) {
			inFence = !inFence;
			return {kind: 'fence'};
		}
		if (inFence) return {kind: 'code', text: row};

		const meta = parseDiffCommentMeta(row);
		if (meta) return {kind: 'caption', text: formatDiffCaption(meta)};

		if (row.trim() === '') return {kind: 'blank'};

		const heading = /^#{1,6}\s+(.*)$/.exec(row);
		if (heading) return {kind: 'heading', spans: inlineSpans(heading[1] ?? '')};

		return {kind: 'text', spans: inlineSpans(row)};
	});
};

const hardWrap = (text: string, width: number): string[] =>
	text.length <= width
		? [text]
		: text.match(new RegExp(`.{1,${width}}`, 'g')) ?? [''];

const flow = (rows: string[], width: number): RenderedLine[] => {
	const out: RenderedLine[] = [];

	for (const line of classifyRows(rows)) {
		if (line.kind === 'fence') continue;

		if (line.kind === 'blank') {
			if (out.length > 0 && out[out.length - 1]?.kind !== 'blank')
				out.push(line);
			continue;
		}

		if (line.kind === 'code') {
			for (const text of hardWrap(line.text, width))
				out.push({kind: 'code', text});
			continue;
		}

		if (line.kind === 'caption') {
			out.push(line);
			continue;
		}

		for (const piece of wrapText(spansToText(line.spans), width)) {
			out.push({kind: line.kind, spans: inlineSpans(piece)});
		}
	}

	while (out.length > 0 && out[out.length - 1]?.kind === 'blank') out.pop();

	return out;
};

// Wrapped to a width, blank runs collapsed: what a comment card needs. A
// diff-linked body renders as its own words, then the caption, then the
// quoted lines numbered as they were where they came from.
export const renderMarkdownLines = (
	md: string,
	width: number,
): RenderedLine[] => {
	const meta = parseDiffCommentMeta(md);
	const snippet = meta ? extractCommentSnippet(md) : null;

	if (!meta || snippet === null) {
		return flow(stripDiffCommentMarker(md).split('\n'), width);
	}

	const lead = extractCommentLead(md);
	const lines = snippet.split('\n').map(expandTabs);
	// A range crossing from deletions into additions quotes both halves,
	// which no single run of numbers describes.
	const startLine = meta.side === meta.endSide ? meta.start : undefined;
	const gutter =
		startLine === undefined
			? 0
			: String(startLine + lines.length - 1).length + 3;

	return [
		...(lead
			? [...flow(lead.split('\n'), width), {kind: 'blank'} as const]
			: []),
		{kind: 'caption', text: formatDiffCaption(meta)},
		...lines.flatMap((text, index) =>
			hardWrap(text, Math.max(1, width - gutter)).map((piece, chunk) => ({
				kind: 'code' as const,
				text: piece,
				number:
					startLine === undefined || chunk > 0 ? undefined : startLine + index,
			})),
		),
	];
};
