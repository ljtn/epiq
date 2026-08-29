import React, {useState} from 'react';
import {SelectedLineRange} from '@pierre/diffs/react';
import {GuiCommitDiffFile, GuiRefCommitEntry} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {ActionRow, Textarea} from './FormPrimitives';
import {Button} from './Button';
import {CopyRef} from './CopyRef';
import {CopyShaButton} from './CopyShaButton';
import {Empty} from './FormPrimitives';
import {FileDiffView} from './DiffPanel';
import {IconChevronDown} from './IconChevronDown';
import {IconChevronRight} from './IconChevronRight';

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
	onClear,
}: {
	file: GuiCommitDiffFile;
	selection: SelectedLineRange;
	onAddComment?: (body: string) => void;
	onClear: () => void;
}) => {
	const [composing, setComposing] = useState(false);
	const [note, setNote] = useState('');

	const submit = () => {
		const snippet = extractSnippet(file, selection);
		const trimmedNote = note.trim();

		const body = [
			...(trimmedNote ? [trimmedNote, ''] : []),
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
			style={{
				marginTop: 8,
				padding: 10,
				border: `1px solid ${GUI_THEME.line}`,
				borderRadius: 8,
				background: GUI_THEME.panel,
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
							<Button variant="ghost" onClick={() => setComposing(true)}>
								Comment
							</Button>
						)}
						{/* File-ticket filing lands in a follow-up — the button previews
						    the intended shape rather than being omitted outright. */}
						<Button variant="ghost" disabled title="Coming soon">
							File ticket
						</Button>
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

const FileRow = ({
	file,
	expanded,
	onToggle,
	diffStyle,
	onAddComment,
}: {
	file: GuiCommitDiffFile;
	expanded: boolean;
	onToggle: () => void;
	diffStyle: 'split' | 'unified';
	onAddComment?: (body: string) => void;
}) => {
	const [selection, setSelection] = useState<SelectedLineRange | null>(null);

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
			</button>

			{expanded && (
				<>
					<FileDiffView
						file={file}
						diffStyle={diffStyle}
						selectedLines={selection}
						onSelectionEnd={setSelection}
					/>
					{selection && (
						<SelectionToolbar
							file={file}
							selection={selection}
							onAddComment={onAddComment}
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
	diffStyle,
	onAddComment,
}: {
	commit: GuiRefCommitEntry;
	diff: CommitDiffState | undefined;
	expanded: boolean;
	onToggle: () => void;
	expandedFiles: Set<string>;
	onToggleFile: (path: string) => void;
	diffStyle: 'split' | 'unified';
	onAddComment?: (body: string) => void;
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

					{diff?.files?.map(file => (
						<FileRow
							key={file.path}
							file={file}
							expanded={expandedFiles.has(file.path)}
							onToggle={() => onToggleFile(file.path)}
							diffStyle={diffStyle}
							onAddComment={onAddComment}
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
}: {
	issueRef: string;
	commits: GuiRefCommitEntry[];
	loading: boolean;
	error: string | null;
	diffsBySha: Record<string, CommitDiffState>;
	onLoadDiff: (sha: string) => void;
	diffStyle: 'split' | 'unified';
	onAddComment?: (body: string) => void;
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
							diffStyle={diffStyle}
							onAddComment={onAddComment}
						/>
					</div>
				</div>
			))}
		</div>
	);
};
