import React, {useEffect, useRef, useState} from 'react';
import {
	DiffLineAnnotation,
	SelectedLineRange,
	SelectionSide,
} from '@pierre/diffs/react';
import {
	GuiComment,
	GuiCommitDiffFile,
	GuiRefCommitEntry,
} from '../lib/gui-state.model';
import {CONTENT_FONT, GUI_THEME, TEXT} from '../lib/gui-theme';
import {timeAgo} from '../lib/gui-format.helper';
import {ActionRow, Textarea} from './FormPrimitives';
import {Button} from './Button';
import {CopyRef} from './CopyRef';
import {CreateNodeModal} from './CreateNodeModal';
import {CopyShaButton} from './CopyShaButton';
import {Empty} from './FormPrimitives';
import {FileDiffView} from './DiffPanel';
import {IconChevronDown} from './IconChevronDown';
import {IconChevronRight} from './IconChevronRight';
import {IconComment} from './IconComment';

export type CommitDiffState = {
	loading: boolean;
	error: string | null;
	files: GuiCommitDiffFile[] | null;
};

// Case-insensitive like the server's own match (getCommitsForRef) — a subject
// that doesn't actually carry the prefix (shouldn't happen, but the match
// isn't a hard guarantee client-side) is returned unchanged rather than mangled.
const stripRefPrefix = (subject: string, ref: string): string => {
	const prefix = `${ref} `;

	return subject.toUpperCase().startsWith(prefix.toUpperCase())
		? subject.slice(prefix.length)
		: subject;
};

// A selection's start/end are the real (gutter-displayed) line numbers within
// whichever side they belong to — 'deletions' means the old file, 'additions'
// the new one. A range can span both sides (dragged from a removed line into
// an added one in split view): quote both halves rather than picking one.
export const extractSnippet = (
	file: GuiCommitDiffFile,
	range: SelectedLineRange,
): string => {
	const linesFor = (side: SelectedLineRange['side']) =>
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

export const formatSelectionLabel = (range: SelectedLineRange): string => {
	const endSide = range.endSide ?? range.side;
	const sideLabel = endSide === 'deletions' ? 'removed' : 'added';

	return range.start === range.end
		? `line ${range.start} (${sideLabel})`
		: `lines ${range.start}-${range.end} (${sideLabel})`;
};

// Quoted lines keep their real source indentation (often several tabs deep
// inside nested JSX) — fine in the wide diff, unreadable in a narrow comment
// box. Strips the whitespace every non-blank line shares, same as most
// editors' own "copy" behavior.
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

// Metadata for a diff-selection comment, carried as an HTML-comment-shaped
// marker in the posted body — round-trips through storage intact with no
// separate field needed on GuiComment. react-markdown does *not* silently
// drop `<!-- ... -->` without rehype-raw as might be assumed — it renders
// the literal text — so every render path showing a comment body must strip
// it via stripDiffCommentMarker below rather than relying on the markdown
// renderer to hide it.
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

const isSelectionSide = (value: unknown): value is SelectionSide =>
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

export type DiffComment = {comment: GuiComment; meta: DiffCommentMeta};

export const findDiffCommentsForFile = (
	comments: GuiComment[],
	filePath: string,
): DiffComment[] =>
	comments.flatMap(comment => {
		const meta = parseDiffCommentMeta(comment.body);
		return meta && meta.filePath === filePath ? [{comment, meta}] : [];
	});

// The fenced block a diff-selection comment's body ends with. Pulled back out
// so the snippet can be rendered as real highlighted code instead of markdown
// text — the body keeps carrying it verbatim so the comment still reads
// correctly anywhere that only knows how to render markdown.
const SNIPPET_FENCE = /```\n([\s\S]*?)\n?```\s*$/;

export const extractCommentSnippet = (body: string): string | null =>
	SNIPPET_FENCE.exec(body)?.[1] ?? null;

// What a "File ticket" submission carries up to the caller that owns the
// actual issues:create call and the origin-ticket back-comment — everything
// needed to build both without the caller re-deriving any of it.
export type FileTicketParams = {
	sha: string;
	filePath: string;
	range: SelectedLineRange;
	snippet: string;
	title: string;
	note: string;
};

// A spot in a ticket's Commits tab, deep-linkable from a comment. Lives in the
// URL rather than in transient state so the link survives a reload and can be
// handed to someone else.
export type DiffLocation = {
	sha: string;
	filePath: string;
	start: number;
	end: number;
	side: SelectionSide;
	endSide: SelectionSide;
	// Set when the diff lives on another ticket's Commits tab.
	issueRef?: string;
};

export const diffLocationFromMeta = (
	meta: DiffCommentMeta,
): DiffLocation | null =>
	meta.sha
		? {
				sha: meta.sha,
				filePath: meta.filePath,
				start: meta.start,
				end: meta.end,
				side: meta.side,
				endSide: meta.endSide,
				...(meta.issueRef ? {issueRef: meta.issueRef} : {}),
		  }
		: null;

const DIFF_LOCATION_PARAMS = [
	'commit',
	'file',
	'from',
	'to',
	'side',
	'endSide',
] as const;

export const writeDiffLocationParams = (
	params: URLSearchParams,
	location: DiffLocation,
): void => {
	params.set('commit', location.sha);
	params.set('file', location.filePath);
	params.set('from', String(location.start));
	params.set('to', String(location.end));
	params.set('side', location.side);
	params.set('endSide', location.endSide);
};

export const clearDiffLocationParams = (params: URLSearchParams): void => {
	for (const key of DIFF_LOCATION_PARAMS) params.delete(key);
};

export const readDiffLocationParams = (
	params: URLSearchParams,
): DiffLocation | null => {
	const sha = params.get('commit');
	const filePath = params.get('file');
	const start = Number(params.get('from'));
	const end = Number(params.get('to'));
	const side = params.get('side');
	const endSide = params.get('endSide');

	if (
		!sha ||
		!filePath ||
		!Number.isFinite(start) ||
		!Number.isFinite(end) ||
		!isSelectionSide(side) ||
		!isSelectionSide(endSide)
	) {
		return null;
	}

	return {sha, filePath, start, end, side, endSide};
};

// The timeline rail: a dot per commit, in the scrubber's own commit-series
// color, connected to the next by a line. RAIL_DOT_OFFSET lines the dot up
// with the header's text (padding-top plus half its line height), not the
// row's overall height, which grows when a commit is expanded.
const RAIL_WIDTH = 24;
const RAIL_DOT_OFFSET = 19;
const ROW_GAP = 14;

const disclosureStyle: React.CSSProperties = {
	display: 'flex',
	alignItems: 'center',
	gap: 8,
	width: '100%',
	textAlign: 'left',
	background: 'transparent',
	border: 'none',
	cursor: 'pointer',
	color: GUI_THEME.primary,
	font: 'inherit',
	fontSize: TEXT.ui,
};

// A rounded pill rather than GitHub's five solid squares — matches the
// rest of the app's soft, rounded chrome instead of copying its exact look.
const DiffStat = ({
	insertions,
	deletions,
}: {
	insertions: number;
	deletions: number;
}) => {
	const total = insertions + deletions;
	if (total === 0) return null;

	const addRatio = insertions / total;

	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: 6,
				flexShrink: 0,
				fontFamily: 'ui-monospace, monospace',
				fontSize: TEXT.meta,
			}}
		>
			<span style={{color: GUI_THEME.green}}>+{insertions}</span>
			<span style={{color: GUI_THEME.red}}>-{deletions}</span>
			<div
				style={{
					width: 32,
					height: 3,
					borderRadius: 1.5,
					overflow: 'hidden',
					display: 'flex',
					background: GUI_THEME.line,
				}}
			>
				<div
					style={{width: `${addRatio * 100}%`, background: GUI_THEME.green}}
				/>
				<div
					style={{
						width: `${(1 - addRatio) * 100}%`,
						background: GUI_THEME.red,
					}}
				/>
			</div>
		</div>
	);
};

// Rendered by MultiFileDiff right under the last selected line. One box for
// both outcomes: write the note first, then choose whether it becomes a
// comment on this ticket or a new ticket of its own.
const SelectionComposer = ({
	sha,
	file,
	selection,
	note,
	onChangeNote,
	onAddComment,
	onFileTicket,
	onClear,
}: {
	sha: string;
	file: GuiCommitDiffFile;
	selection: SelectedLineRange;
	note: string;
	onChangeNote: (note: string) => void;
	onAddComment?: (body: string) => void;
	// Opens the title prompt; the row owns the actual filing.
	onFileTicket?: () => void;
	onClear: () => void;
}) => {
	const snippet = dedent(extractSnippet(file, selection));
	const selectionLabel = `${file.path} ${formatSelectionLabel(selection)}`;

	const comment = () => {
		const trimmedNote = note.trim();
		// Matches extractSnippet's own default: a range without a reported side
		// is expected to be a modern-git edge case at worst, not a real gap.
		const side = selection.side ?? 'additions';
		const endSide = selection.endSide ?? side;

		const marker = encodeDiffCommentMarker({
			filePath: file.path,
			start: selection.start,
			side,
			end: selection.end,
			endSide,
			note: trimmedNote,
			sha,
		});

		const body = [
			...(trimmedNote ? [trimmedNote, ''] : []),
			marker,
			`\`${file.path}\` ${formatSelectionLabel(selection)}`,
			'```',
			snippet,
			'```',
		].join('\n');

		onAddComment?.(body);
		onClear();
	};

	return (
		<div
			data-testid="selection-composer"
			style={{
				margin: '4px 0',
				padding: 10,
				border: `1px solid ${GUI_THEME.accent}`,
				borderRadius: 8,
				background: GUI_THEME.tertiary,
				boxShadow: `0 0 0 1px ${GUI_THEME.accent}33`,
			}}
		>
			<div style={{fontSize: TEXT.meta, color: GUI_THEME.secondary}}>
				{selectionLabel}
			</div>

			<Textarea
				autoFocus
				maxLength={Number.MAX_SAFE_INTEGER}
				value={note}
				placeholder="Add a note (optional)"
				onChange={event => onChangeNote(event.target.value)}
				onKeyDown={event => {
					if (event.key === 'Escape') onClear();
					if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
						if (onAddComment) comment();
					}
				}}
				style={{
					marginTop: 8,
					minHeight: 45,
					font: 'inherit',
					fontFamily: CONTENT_FONT,
					fontSize: TEXT.prose,
				}}
			/>

			<ActionRow>
				<Button variant="ghost" onClick={onClear}>
					Cancel
				</Button>
				{onFileTicket && (
					<Button variant="default" onClick={onFileTicket}>
						File ticket
					</Button>
				)}
				{onAddComment && (
					<Button variant="primary" onClick={comment}>
						Comment
					</Button>
				)}
			</ActionRow>
		</div>
	);
};

// What a file's diff carries at a line: an existing comment, or the composer
// for the range being selected right now.
type RowAnnotation =
	| {kind: 'comment'; entry: DiffComment}
	| {kind: 'composer'; selection: SelectedLineRange};

// Rendered by MultiFileDiff at the line a diff-selection comment is anchored
// to. Just the author and note — the full body (including the requoted
// snippet, redundant here since the diff itself is right above it) lives in
// the Comments tab.
const DiffCommentAnnotation = ({
	entry,
	onHover,
}: {
	entry: DiffComment;
	onHover: (hovering: boolean) => void;
}) => {
	const {comment, meta} = entry;

	return (
		<div
			data-testid="diff-comment"
			onMouseEnter={() => onHover(true)}
			onMouseLeave={() => onHover(false)}
			style={{
				margin: '4px 0',
				padding: '8px 10px',
				border: `1px solid ${GUI_THEME.line}`,
				borderLeft: `2px solid ${GUI_THEME.accent}`,
				borderRadius: 6,
				background: GUI_THEME.tertiary,
				fontSize: TEXT.ui,
			}}
		>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 8,
					color: GUI_THEME.secondary,
					fontSize: TEXT.meta,
				}}
			>
				<span style={{display: 'inline-flex', color: GUI_THEME.accent}}>
					<IconComment size={12} />
				</span>
				<span>
					{comment.author.name ?? 'unknown'}
					{comment.createdAt && (
						<span style={{color: GUI_THEME.dim2}}>
							{' '}
							· {timeAgo(comment.createdAt)}
						</span>
					)}
				</span>
			</div>
			<div style={{marginTop: 4}}>
				{meta.note || <em style={{color: GUI_THEME.dim}}>commented</em>}
			</div>
		</div>
	);
};

const FileRow = ({
	sha,
	file,
	expanded,
	onToggle,
	diffStyle,
	onAddComment,
	onFileTicket,
	comments,
	focusRange,
}: {
	sha: string;
	file: GuiCommitDiffFile;
	expanded: boolean;
	onToggle: () => void;
	diffStyle: 'split' | 'unified';
	onAddComment?: (body: string) => void;
	onFileTicket?: (params: FileTicketParams) => void;
	comments: GuiComment[];
	// Set when a comment permalink points at this file: seeds the highlight
	// and scrolls the diff into view.
	focusRange?: SelectedLineRange | null;
}) => {
	const [selection, setSelection] = useState<SelectedLineRange | null>(null);
	// Held here rather than in the composer so re-dragging the range keeps
	// what was typed.
	const [note, setNote] = useState('');
	const rowRef = useRef<HTMLDivElement | null>(null);

	// The title being typed for a ticket filed off the selection; null while
	// the prompt is closed. Asked for rather than inferred from the note, so
	// the note stays a note.
	const [ticketTitle, setTicketTitle] = useState<string | null>(null);
	// The range of the comment under the pointer, lit up so the reader can
	// see which lines it is about.
	const [hoveredRange, setHoveredRange] = useState<SelectedLineRange | null>(
		null,
	);

	const clearSelection = () => {
		setSelection(null);
		setNote('');
		setTicketTitle(null);
	};

	const fileTicket = () => {
		const title = ticketTitle?.trim();
		if (!title || !selection) return;

		onFileTicket?.({
			sha,
			filePath: file.path,
			range: selection,
			snippet: dedent(extractSnippet(file, selection)),
			title,
			note: note.trim(),
		});
		clearSelection();
	};

	// Keyed on the range's own values, not object identity — the parent
	// rebuilds it from URL params on every render, and depending on identity
	// would re-scroll (and re-select) forever.
	const focusKey = focusRange
		? `${focusRange.start}-${focusRange.end}-${focusRange.side}-${focusRange.endSide}`
		: null;

	useEffect(() => {
		if (!focusRange || !expanded) return;

		setSelection(focusRange);
		rowRef.current?.scrollIntoView({block: 'center', behavior: 'smooth'});
	}, [focusKey, expanded]);

	const fileComments = findDiffCommentsForFile(comments, file.path);

	const lineAnnotations: DiffLineAnnotation<RowAnnotation>[] = fileComments.map(
		entry => ({
			side: entry.meta.endSide,
			lineNumber: entry.meta.end,
			metadata: {kind: 'comment', entry},
		}),
	);

	if (selection) {
		const side = selection.endSide ?? selection.side ?? 'additions';

		lineAnnotations.push({
			side,
			lineNumber: selection.end,
			metadata: {kind: 'composer', selection},
		});
	}

	return (
		<div ref={rowRef} style={{marginTop: 8}}>
			<button
				onClick={onToggle}
				aria-expanded={expanded}
				style={{
					...disclosureStyle,
					color: GUI_THEME.secondary,
					padding: '4px 0',
				}}
			>
				{expanded ? (
					<IconChevronDown size={12} />
				) : (
					<IconChevronRight size={12} />
				)}
				<span
					style={{
						fontFamily: 'ui-monospace, monospace',
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
					}}
				>
					{file.path}
				</span>
				{/* Findable when collapsed — otherwise a comment left on a file with
				    several others is easy to lose track of. */}
				{fileComments.length > 0 && (
					<span
						title={`${fileComments.length} comment${
							fileComments.length === 1 ? '' : 's'
						}`}
						style={{
							display: 'inline-flex',
							alignItems: 'center',
							gap: 3,
							flexShrink: 0,
							color: GUI_THEME.accent,
							fontSize: TEXT.label,
						}}
					>
						<IconComment size={10} />
						{fileComments.length}
					</span>
				)}
			</button>

			{expanded && (
				<>
					<FileDiffView
						file={file}
						diffStyle={diffStyle}
						selectedLines={hoveredRange ?? selection}
						onSelectionEnd={setSelection}
						lineAnnotations={lineAnnotations}
						renderAnnotation={({metadata}) =>
							metadata.kind === 'comment' ? (
								<DiffCommentAnnotation
									entry={metadata.entry}
									onHover={hovering => {
										const {start, end, side, endSide} = metadata.entry.meta;
										setHoveredRange(
											hovering ? {start, end, side, endSide} : null,
										);
									}}
								/>
							) : (
								<SelectionComposer
									sha={sha}
									file={file}
									selection={metadata.selection}
									note={note}
									onChangeNote={setNote}
									onAddComment={onAddComment}
									// Prefilled with the note's first line: what was just
									// written is usually the title, and is still editable.
									onFileTicket={
										onFileTicket
											? () => setTicketTitle(note.trim().split('\n')[0] ?? '')
											: undefined
									}
									onClear={clearSelection}
								/>
							)
						}
					/>
					{ticketTitle !== null && selection && (
						<CreateNodeModal
							eyebrow="File a ticket"
							fieldLabel={`${file.path} ${formatSelectionLabel(selection)}`}
							placeholder="Ticket title"
							confirmLabel="file ticket"
							title={ticketTitle}
							onChangeTitle={setTicketTitle}
							onCreate={fileTicket}
							onClose={() => setTicketTitle(null)}
						/>
					)}
				</>
			)}
		</div>
	);
};

const CommitRow = ({
	commit,
	diff,
	expanded,
	onToggle,
	expandedFiles,
	onToggleFile,
	onSetAllFilesExpanded,
	diffStyle,
	onAddComment,
	onFileTicket,
	comments,
	focus,
}: {
	commit: GuiRefCommitEntry;
	diff: CommitDiffState | undefined;
	expanded: boolean;
	onToggle: () => void;
	expandedFiles: Set<string>;
	onToggleFile: (path: string) => void;
	onSetAllFilesExpanded: (filePaths: string[], expand: boolean) => void;
	diffStyle: 'split' | 'unified';
	onAddComment?: (body: string) => void;
	onFileTicket?: (params: FileTicketParams) => void;
	comments: GuiComment[];
	// Non-null only on the commit a permalink points at.
	focus?: DiffLocation | null;
}) => {
	const [hovered, setHovered] = useState(false);
	// Also tracks focus (not just mouse hover): the copy button is a real
	// nested <button>, so a keyboard user can Tab straight to it — without
	// this it would sit there focused but invisible (opacity 0) until Enter.
	const [focused, setFocused] = useState(false);
	const revealed = hovered || focused;

	return (
		<div
			style={{
				border: `1px solid ${GUI_THEME.line}`,
				borderRadius: 8,
				overflow: 'hidden',
			}}
		>
			{/* A div, not a button: it holds CopyShaButton, a real nested button,
		    which native <button> nesting forbids. role/tabIndex/onKeyDown stand
		    in for what the element would otherwise give for free. */}
			<div
				role="button"
				tabIndex={0}
				onClick={onToggle}
				onKeyDown={event => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						onToggle();
					}
				}}
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				aria-expanded={expanded}
				style={{...disclosureStyle, padding: '13px 14px'}}
			>
				{/* Subject leads the row with nothing before it — the sha and caret
			    are lookup/navigation chrome, not part of reading the list, so
			    they sit at the far right instead of crowding the start of every
			    line. The sha itself only appears on hover or once expanded —
			    reachable without a full expand, but not permanent clutter. */}
				<span
					style={{
						flex: 1,
						minWidth: 0,
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
					}}
				>
					{commit.subject}
				</span>
				<DiffStat insertions={commit.insertions} deletions={commit.deletions} />
				{/* Always mounted, opacity-toggled rather than conditionally rendered:
			    swapping it in/out of the tree changed the row's flex height on
			    hover, which the rail lines (sized off that height) visibly jumped
			    with. Keeping it in flow always reserves the same space. */}
				<span
					style={{
						flexShrink: 0,
						opacity: expanded || revealed ? 1 : 0,
						pointerEvents: expanded || revealed ? 'auto' : 'none',
						transition: 'opacity 120ms ease',
					}}
				>
					<CopyShaButton sha={commit.sha} />
				</span>
				{/* Flex items shrink by default; without this a tight panel width
			    squeezes the caret toward invisible rather than truncating the
			    (already-shrinkable) subject text further. */}
				<span style={{flexShrink: 0, display: 'flex'}}>
					{expanded ? (
						<IconChevronDown size={12} />
					) : (
						<IconChevronRight size={12} />
					)}
				</span>
			</div>

			{expanded && (
				<div
					style={{
						padding: '0 10px 10px',
						borderTop: `1px solid ${GUI_THEME.line}`,
					}}
				>
					{diff?.loading && <Empty>Loading files…</Empty>}
					{!diff?.loading && diff?.error && <Empty>{diff.error}</Empty>}

					{diff?.files && diff.files.length > 1 && (
						<div style={{display: 'flex', justifyContent: 'flex-end'}}>
							<Button
								variant="ghost"
								onClick={() => {
									const filePaths = diff.files!.map(file => file.path);
									const allExpanded = filePaths.every(path =>
										expandedFiles.has(path),
									);
									onSetAllFilesExpanded(filePaths, !allExpanded);
								}}
							>
								{diff.files.every(file => expandedFiles.has(file.path))
									? 'Collapse all'
									: 'Expand all'}
							</Button>
						</div>
					)}

					{diff?.files?.map(file => (
						<FileRow
							key={file.path}
							sha={commit.sha}
							file={file}
							expanded={expandedFiles.has(file.path)}
							onToggle={() => onToggleFile(file.path)}
							diffStyle={diffStyle}
							onAddComment={onAddComment}
							onFileTicket={onFileTicket}
							comments={comments}
							focusRange={
								focus?.filePath === file.path
									? {
											start: focus.start,
											end: focus.end,
											side: focus.side,
											endSide: focus.endSide,
									  }
									: null
							}
						/>
					))}
				</div>
			)}
		</div>
	);
};

// The tree this renders:
//
// Issue
//  ├── Commit A
//  │     ├── server.ts
//  │     └── auth.ts
//  └── Commit B
//        └── ui.tsx
//
// Deliberately per-commit rather than a flattened file list across the whole
// ticket — a file touched in two commits shows twice, once per commit, same
// as GitHub's "Commits" tab vs. its squashed "Files changed" tab.
export const IssueCommits = ({
	issueRef,
	commits,
	loading,
	error,
	diffsBySha,
	onLoadDiff,
	diffStyle,
	onAddComment,
	onFileTicket,
	comments,
	focus,
}: {
	issueRef: string;
	commits: GuiRefCommitEntry[];
	loading: boolean;
	error: string | null;
	diffsBySha: Record<string, CommitDiffState>;
	onLoadDiff: (sha: string) => void;
	diffStyle: 'split' | 'unified';
	onAddComment?: (body: string) => void;
	onFileTicket?: (params: FileTicketParams) => void;
	comments: GuiComment[];
	// Where a comment permalink points, read from the URL by the caller.
	focus?: DiffLocation | null;
}) => {
	const [expandedShas, setExpandedShas] = useState<Set<string>>(new Set());
	const [expandedFilesBySha, setExpandedFilesBySha] = useState<
		Record<string, Set<string>>
	>({});

	// Opens the commit and file a permalink names. Deliberately additive — it
	// never collapses anything the reader already had open, so following a
	// link into a tab you were already using doesn't throw your place away.
	// Keyed on the location's own values rather than object identity, which
	// the caller rebuilds from URL params on every render.
	const focusKey = focus ? `${focus.sha}:${focus.filePath}` : null;

	useEffect(() => {
		if (!focus) return;

		setExpandedShas(prev =>
			prev.has(focus.sha) ? prev : new Set(prev).add(focus.sha),
		);

		setExpandedFilesBySha(prev =>
			prev[focus.sha]?.has(focus.filePath)
				? prev
				: {
						...prev,
						[focus.sha]: new Set(prev[focus.sha] ?? []).add(focus.filePath),
				  },
		);
	}, [focusKey]);

	// Separate from the expand effect above: the diff has to be fetched too,
	// and only when it isn't already loading or loaded.
	useEffect(() => {
		if (!focus) return;

		const existing = diffsBySha[focus.sha];
		if (!existing || existing.error) onLoadDiff(focus.sha);
	}, [focusKey]);

	const toggleCommit = (sha: string) => {
		const alreadyExpanded = expandedShas.has(sha);

		setExpandedShas(prev => {
			const next = new Set(prev);
			if (alreadyExpanded) {
				next.delete(sha);
			} else {
				next.add(sha);
			}
			return next;
		});

		// Also retries on a prior failure — a truthy-but-errored entry would
		// otherwise stay stuck showing that error forever, since collapsing and
		// re-expanding is the only other trigger and it hits this same guard.
		if (!alreadyExpanded && (!diffsBySha[sha] || diffsBySha[sha].error)) {
			onLoadDiff(sha);
		}
	};

	const toggleFile = (sha: string, path: string) => {
		setExpandedFilesBySha(prev => {
			const current = new Set(prev[sha] ?? []);
			if (current.has(path)) {
				current.delete(path);
			} else {
				current.add(path);
			}
			return {...prev, [sha]: current};
		});
	};

	const setAllFilesExpanded = (
		sha: string,
		filePaths: string[],
		expand: boolean,
	) => {
		setExpandedFilesBySha(prev => ({
			...prev,
			[sha]: expand ? new Set(filePaths) : new Set(),
		}));
	};

	if (loading) return <Empty>Loading commits…</Empty>;
	if (error) return <Empty>{error}</Empty>;
	if (commits.length === 0) {
		return (
			<Empty>
				No commits reference this ticket yet. Prefix a commit message with{' '}
				<CopyRef refValue={issueRef} /> to link it here.
			</Empty>
		);
	}

	// Oldest first, reading top-to-bottom as the story unfolded — the log
	// itself comes back newest-first. The ref prefix is stripped from the
	// displayed subject too: every commit in this list already matches
	// issueRef by definition, so repeating it on every row is pure noise.
	const ordered = [...commits]
		.sort((a, b) => a.time - b.time)
		.map(commit => ({
			...commit,
			subject: stripRefPrefix(commit.subject, issueRef),
		}));

	return (
		<div>
			{ordered.map((commit, index) => (
				<div key={commit.sha} style={{display: 'flex', marginBottom: ROW_GAP}}>
					{/* The rail: a dot per commit in the scrubber's own commit-series
					    color. Connected to the next only when they're truly adjacent in
					    the real history (precedingSha) — a broken chain (some other
					    ticket's commit landed between them) gets no line, just dots, so
					    the rail doesn't imply a continuity that isn't there.
					    position: relative + stretch (the flex row's default
					    align-items) makes this column exactly as tall as CommitRow
					    ends up rendering, expanded or not, with no measuring needed —
					    the line just extends into the gap below via a negative bottom. */}
					<div style={{width: RAIL_WIDTH, flexShrink: 0, position: 'relative'}}>
						<div
							style={{
								position: 'absolute',
								left: '50%',
								top: RAIL_DOT_OFFSET,
								width: 8,
								height: 8,
								borderRadius: '50%',
								background: GUI_THEME.green,
								transform: 'translate(-50%, -50%)',
							}}
						/>
						{index < ordered.length - 1 &&
							(ordered[index + 1].precedingSha === commit.sha ? (
								<div
									style={{
										position: 'absolute',
										left: '50%',
										top: RAIL_DOT_OFFSET,
										// Reaches the *next* dot, not just this row's own bottom
										// edge: that dot sits RAIL_DOT_OFFSET below the start of
										// its own row, past the ROW_GAP margin between the two.
										bottom: -(ROW_GAP + RAIL_DOT_OFFSET),
										width: 2,
										background: GUI_THEME.green,
										opacity: 0.4,
										transform: 'translateX(-50%)',
									}}
								/>
							) : (
								// A broken chain: some other ticket's commit sits between
								// these two in real history. Dotted and fainter rather than
								// no line at all — the two are still adjacent in this list,
								// just not in the underlying history.
								<div
									style={{
										position: 'absolute',
										left: '50%',
										top: RAIL_DOT_OFFSET,
										bottom: -(ROW_GAP + RAIL_DOT_OFFSET),
										width: 0,
										borderLeft: `2px dotted ${GUI_THEME.green}`,
										opacity: 0.25,
										transform: 'translateX(-50%)',
									}}
								/>
							))}
					</div>

					<div style={{flex: 1, minWidth: 0}}>
						<CommitRow
							commit={commit}
							diff={diffsBySha[commit.sha]}
							expanded={expandedShas.has(commit.sha)}
							onToggle={() => toggleCommit(commit.sha)}
							expandedFiles={expandedFilesBySha[commit.sha] ?? new Set()}
							onToggleFile={path => toggleFile(commit.sha, path)}
							onSetAllFilesExpanded={(paths, expand) =>
								setAllFilesExpanded(commit.sha, paths, expand)
							}
							diffStyle={diffStyle}
							onAddComment={onAddComment}
							onFileTicket={onFileTicket}
							comments={comments}
							focus={focus?.sha === commit.sha ? focus : null}
						/>
					</div>
				</div>
			))}
		</div>
	);
};
