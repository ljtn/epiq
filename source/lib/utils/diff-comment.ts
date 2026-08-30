// A comment made on a selection in a commit diff carries where it was made as
// an HTML-comment-shaped marker in its body, followed by a caption line and
// the quoted lines in a fence. The body stays readable anywhere that only
// knows markdown; anything that knows the marker can do better.

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
	// Which commit's diff the selection was made in — a file can appear in
	// several of a ticket's commits, so linking back needs it. Optional
	// because comments written before it was recorded should still render
	// their inline annotation; they just aren't clickable.
	sha?: string;
	// The ticket whose Commits tab holds the diff, when it isn't the one the
	// marker sits on — a ticket filed from a selection points back at its
	// origin this way.
	issueRef?: string;
};

const DIFF_COMMENT_MARKER = /<!--\s*epiq-diff-comment:(.+?)-->\n?/;

export const stripDiffCommentMarker = (body: string): string =>
	body.replace(DIFF_COMMENT_MARKER, '');

// `>` is escaped so a note containing `-->` cannot terminate the marker early
// — that truncated the JSON (losing the annotation) and left the remainder
// visible as garbage in the rendered comment. JSON.parse decodes > back
// to `>`, so the round trip is exact.
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

// The body of a diff-selection comment with its note replaced and everything
// else — marker location, caption, quoted snippet — kept as it was. Null for a
// body that carries no marker.
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

// The fenced block a diff-selection comment's body ends with. Pulled back out
// so the snippet can be rendered as real code instead of markdown text — the
// body keeps carrying it verbatim so the comment still reads correctly
// anywhere that only knows how to render markdown.
const SNIPPET_FENCE = /```\n([\s\S]*?)\n?```\s*$/;

export const extractCommentSnippet = (body: string): string | null =>
	SNIPPET_FENCE.exec(body)?.[1] ?? null;

// The caption line written right above the fence: the quoted file in
// backticks, then the line range.
const CAPTION_LINE = /`[^`\n]+`[^\n]*\n?$/;

// What a diff-linked body says in its own words: everything before the
// marker's caption and quoted snippet. Read off the body rather than the
// marker's `note` copy, so text typed into the body by hand (a description
// edited in the Overview, a comment edited from the TUI) still shows.
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
