import React, {useState} from 'react';
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
import {GUI_THEME} from '../lib/gui-theme';
import {timeAgo} from '../lib/gui-format.helper';
import {ActionRow, Textarea} from './FormPrimitives';
import {Button} from './Button';
import {CopyRef} from './CopyRef';
import {CopyShaButton} from './CopyShaButton';
import {Empty} from './FormPrimitives';
import {FileDiffView} from './DiffPanel';
import {FileTicketModal} from './FileTicketModal';
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
type DiffCommentMeta = {
	filePath: string;
	start: number;
	side: SelectionSide;
	end: number;
	endSide: SelectionSide;
	note: string;
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

const isSelectionSide = (value: unknown): value is SelectedLineRange['side'] =>
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
		!isSelectionSide(meta.endSide)
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

// What a "File ticket" submission carries up to the caller that owns the
// actual issues:create call and the origin-ticket back-comment — everything
// needed to build both without the caller re-deriving any of it.
export type FileTicketParams = {
	filePath: string;
	range: SelectedLineRange;
	snippet: string;
	title: string;
	note: string;
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
	fontSize: 12,
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
				fontSize: 11,
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

// The bar that appears under a diff once a line range is selected — a plain
// two-step flow (pick an action, then write the optional note) rather than
// trying to float it exactly over the selection, which the diff library
// doesn't hand back pixel coordinates for.
const SelectionToolbar = ({
	file,
	selection,
	onAddComment,
	onFileTicket,
	onClear,
}: {
	file: GuiCommitDiffFile;
	selection: SelectedLineRange;
	onAddComment?: (body: string) => void;
	onFileTicket?: (params: FileTicketParams) => void;
	onClear: () => void;
}) => {
	const [composing, setComposing] = useState(false);
	const [filing, setFiling] = useState(false);
	const [note, setNote] = useState('');

	const snippet = dedent(extractSnippet(file, selection));
	const selectionLabel = `${file.path} ${formatSelectionLabel(selection)}`;

	const submit = () => {
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

	if (filing) {
		return (
			<FileTicketModal
				defaultTitle={selectionLabel}
				snippetLabel={selectionLabel}
				snippet={snippet}
				onCreate={({title, note: filingNote}) => {
					onFileTicket?.({
						filePath: file.path,
						range: selection,
						snippet,
						title,
						note: filingNote,
					});
					onClear();
				}}
				onClose={onClear}
			/>
		);
	}

	return (
		<div
			style={{
				marginTop: 8,
				padding: 10,
				border: `1px solid ${GUI_THEME.accent}`,
				borderRadius: 8,
				background: GUI_THEME.tertiary,
				boxShadow: `0 0 0 1px ${GUI_THEME.accent}33`,
			}}
		>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 8,
					fontSize: 11,
					color: GUI_THEME.secondary,
				}}
			>
				<span style={{flex: 1}}>
					{file.path} {formatSelectionLabel(selection)}
				</span>

				{!composing && (
					<>
						{onAddComment && (
							<Button variant="primary" onClick={() => setComposing(true)}>
								Comment
							</Button>
						)}
						{onFileTicket && (
							<Button variant="default" onClick={() => setFiling(true)}>
								File ticket
							</Button>
						)}
						<Button variant="ghost" onClick={onClear}>
							×
						</Button>
					</>
				)}
			</div>

			{composing && (
				<div style={{marginTop: 8}}>
					<Textarea
						autoFocus
						maxLength={Number.MAX_SAFE_INTEGER}
						value={note}
						placeholder="Add a note (optional)"
						onChange={event => setNote(event.target.value)}
						onKeyDown={event => {
							if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
								submit();
							}
						}}
						style={{minHeight: 45, font: 'inherit', fontSize: 12}}
					/>
					<ActionRow>
						<Button variant="ghost" onClick={onClear}>
							Cancel
						</Button>
						<Button onClick={submit}>Post comment</Button>
					</ActionRow>
				</div>
			)}
		</div>
	);
};

// Rendered by MultiFileDiff at the line a diff-selection comment is anchored
// to. Just the author and note — the full body (including the requoted
// snippet, redundant here since the diff itself is right above it) lives in
// the Comments tab.
const DiffCommentAnnotation = ({
	annotation,
}: {
	annotation: DiffLineAnnotation<DiffComment>;
}) => {
	const {comment, meta} = annotation.metadata;

	return (
		<div
			style={{
				margin: '4px 0',
				padding: '8px 10px',
				border: `1px solid ${GUI_THEME.line}`,
				borderLeft: `2px solid ${GUI_THEME.accent}`,
				borderRadius: 6,
				background: GUI_THEME.tertiary,
				fontSize: 12,
				display: 'flex',
				alignItems: 'flex-start',
				gap: 8,
			}}
		>
			<span style={{color: GUI_THEME.accent, flexShrink: 0, marginTop: 1}}>
				<IconComment size={12} />
			</span>
			<div style={{flex: 1, minWidth: 0}}>
				<div style={{color: GUI_THEME.secondary, fontSize: 11}}>
					{comment.author.name ?? 'unknown'}
					{comment.createdAt && (
						<span style={{color: GUI_THEME.dim2}}>
							{' '}
							· {timeAgo(comment.createdAt)}
						</span>
					)}
				</div>
				<div style={{marginTop: 2}}>
					{meta.note || <em style={{color: GUI_THEME.dim}}>commented</em>}
				</div>
			</div>
		</div>
	);
};

const FileRow = ({
	file,
	expanded,
	onToggle,
	diffStyle,
	onAddComment,
	onFileTicket,
	comments,
}: {
	file: GuiCommitDiffFile;
	expanded: boolean;
	onToggle: () => void;
	diffStyle: 'split' | 'unified';
	onAddComment?: (body: string) => void;
	onFileTicket?: (params: FileTicketParams) => void;
	comments: GuiComment[];
}) => {
	const [selection, setSelection] = useState<SelectedLineRange | null>(null);

	const fileComments = findDiffCommentsForFile(comments, file.path);

	const lineAnnotations: DiffLineAnnotation<DiffComment>[] = fileComments.map(
		entry => ({
			side: entry.meta.endSide,
			lineNumber: entry.meta.end,
			metadata: entry,
		}),
	);

	return (
		<div style={{marginTop: 8}}>
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
							fontSize: 10,
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
						selectedLines={selection}
						onSelectionEnd={setSelection}
						lineAnnotations={lineAnnotations}
						renderAnnotation={annotation => (
							<DiffCommentAnnotation annotation={annotation} />
						)}
					/>
					{selection && (
						<SelectionToolbar
							file={file}
							selection={selection}
							onAddComment={onAddComment}
							onFileTicket={onFileTicket}
							onClear={() => setSelection(null)}
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
							file={file}
							expanded={expandedFiles.has(file.path)}
							onToggle={() => onToggleFile(file.path)}
							diffStyle={diffStyle}
							onAddComment={onAddComment}
							onFileTicket={onFileTicket}
							comments={comments}
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
}) => {
	const [expandedShas, setExpandedShas] = useState<Set<string>>(new Set());
	const [expandedFilesBySha, setExpandedFilesBySha] = useState<
		Record<string, Set<string>>
	>({});

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
						/>
					</div>
				</div>
			))}
		</div>
	);
};
