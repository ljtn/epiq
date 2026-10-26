// A diff-selection comment's body: a hidden marker with its location, a
// caption and the quoted lines in a fence, readable as plain markdown.

export type SelectionSide = 'additions' | 'deletions';

export type SelectionRange = {
	start: number;
	end: number;
	side?: SelectionSide;
	endSide?: SelectionSide;
};

export type DiffCommentMeta = {
	filePath: string;
	start: number;
	side: SelectionSide;
	end: number;
	endSide: SelectionSide;
	note: string;
	// Which commit's diff the selection was made in; optional for older comments,
	// which render but don't link.
	sha?: string;
	// The ticket whose Commits tab holds the diff, when not the one it sits on.
	issueRef?: string;
};

const DIFF_COMMENT_MARKER = /<!--\s*epiq-diff-comment:(.+?)-->\n?/;

export const stripDiffCommentMarker = (body: string): string =>
	body.replace(DIFF_COMMENT_MARKER, '');

// `>` is escaped so a note containing `-->` can't end the marker; JSON.parse
// restores it.
export const encodeDiffCommentMarker = (meta: DiffCommentMeta): string =>
	`<!-- epiq-diff-comment:${JSON.stringify(meta).replaceAll(
		'>',
		'\\u003e',
	)} -->`;

export const isSelectionSide = (value: unknown): value is SelectionSide =>
	value === 'additions' || value === 'deletions';

export const parseDiffCommentMeta = (body: string): DiffCommentMeta | null => {
	const match = DIFF_COMMENT_MARKER.exec(body);
	if (!match?.[1]) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(match[1]);
	} catch {
		return null;
	}

	const meta = parsed as Partial<DiffCommentMeta> | null;

	if (
		typeof meta?.filePath !== 'string' ||
		typeof meta.start !== 'number' ||
		typeof meta.end !== 'number' ||
		typeof meta.note !== 'string' ||
		!isSelectionSide(meta.side) ||
		!isSelectionSide(meta.endSide) ||
		(meta.sha !== undefined && typeof meta.sha !== 'string') ||
		(meta.issueRef !== undefined && typeof meta.issueRef !== 'string')
	) {
		return null;
	}

	return meta as DiffCommentMeta;
};

// The body with its note replaced and the rest kept; null without a marker.
export const withDiffCommentNote = (
	body: string,
	note: string,
): string | null => {
	const meta = parseDiffCommentMeta(body);
	const match = DIFF_COMMENT_MARKER.exec(body);
	if (!meta || !match) return null;

	const trimmed = note.trim();
	const rest = body.slice(match.index + match[0].length);

	return [
		...(trimmed ? [trimmed, ''] : []),
		encodeDiffCommentMarker({...meta, note: trimmed}),
		rest,
	].join('\n');
};

// The trailing fenced snippet, for rendering as code.
const SNIPPET_FENCE = /```\n([\s\S]*?)\n?```\s*$/;

export const extractCommentSnippet = (body: string): string | null =>
	SNIPPET_FENCE.exec(body)?.[1] ?? null;

// The caption line written right above the fence: the quoted file in
// backticks, then the line range.
const CAPTION_LINE = /`[^`\n]+`[^\n]*\n?$/;

// The body's own text before the caption and snippet, read from the body
// rather than the marker's `note`, so hand edits show.
export const extractCommentLead = (body: string): string =>
	stripDiffCommentMarker(body)
		.replace(SNIPPET_FENCE, '')
		.replace(CAPTION_LINE, '')
		.trim();

export const formatSelectionLabel = (range: SelectionRange): string => {
	const endSide = range.endSide ?? range.side;
	const sideLabel = endSide === 'deletions' ? 'removed' : 'added';

	return range.start === range.end
		? `line ${range.start} (${sideLabel})`
		: `lines ${range.start}-${range.end} (${sideLabel})`;
};

// What a diff-linked body is headed by wherever it is shown: the origin
// ticket when there is one, the file, the line range.
export const formatDiffCaption = (meta: DiffCommentMeta): string =>
	`${meta.issueRef ? `${meta.issueRef} · ` : ''}${
		meta.filePath
	} ${formatSelectionLabel(meta)}`;

// Start/end are real line numbers on their side ('deletions' old, 'additions'
// new); a range spanning both quotes both halves.
export const extractSnippet = (
	file: {before: string; after: string},
	range: SelectionRange,
): string => {
	const linesFor = (side: SelectionSide | undefined) =>
		(side === 'deletions' ? file.before : file.after).split('\n');

	const endSide = range.endSide ?? range.side;

	if (endSide === range.side) {
		return linesFor(range.side)
			.slice(range.start - 1, range.end)
			.join('\n');
	}

	const startHalf = linesFor(range.side).slice(range.start - 1);
	const endHalf = linesFor(endSide).slice(0, range.end);

	return [...startHalf, ...endHalf].join('\n');
};

// Strips the indentation every non-blank quoted line shares.
export const dedent = (snippet: string): string => {
	const lines = snippet.split('\n');

	const commonIndent = lines
		.filter(line => line.trim() !== '')
		.reduce<number | null>((min, line) => {
			const indent = /^[ \t]*/.exec(line)?.[0].length ?? 0;
			return min === null ? indent : Math.min(min, indent);
		}, null);

	if (!commonIndent) return snippet;

	return lines.map(line => line.slice(commonIndent)).join('\n');
};

/**
 * The whole body of a diff-selection comment, shared by GUI and TUI so both
 * build it byte for byte the same.
 */
export const buildDiffCommentBody = ({
	snippet,
	...meta
}: Omit<DiffCommentMeta, 'note'> & {
	note: string;
	snippet: string;
}): string => {
	const note = meta.note.trim();

	return [
		...(note ? [note, ''] : []),
		encodeDiffCommentMarker({...meta, note}),
		`\`${meta.filePath}\` ${formatSelectionLabel(meta)}`,
		'```',
		dedent(snippet),
		'```',
	].join('\n');
};
