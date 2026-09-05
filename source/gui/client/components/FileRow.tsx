import React, {useEffect, useRef, useState} from 'react';
import {DiffLineAnnotation, SelectedLineRange} from '@pierre/diffs/react';
import {GuiComment, GuiCommitDiffFile} from '../lib/gui-state.model';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {diffLineCount, isLargeDiff} from '../../../lib/utils/diff-size.js';
import {COMMENT_CARD_STYLE} from '../lib/comment-card.style';
import {formatSelectionLabel} from '../../../lib/utils/diff-comment.js';
import {timeAgo} from '../lib/gui-format.helper';
import {Checkbox} from './Checkbox';
import {CreateNodeModal} from './CreateNodeModal';
import {DIFF_BOX_STYLE, FileDiffView} from './DiffPanel';
import {IconChevronDown} from './IconChevronDown';
import {IconChevronRight} from './IconChevronRight';
import {IconComment} from './IconComment';
import {
	extractSnippet,
	dedent,
	DiffComment,
	findDiffCommentsForFile,
	FileTicketParams,
} from '../lib/diff-selection';
import {disclosureStyle, DISCLOSURE_HOVER_BG} from '../lib/commit-row.style';
import {DiffStat} from './DiffStat';
import {SelectionComposer} from './SelectionComposer';

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
				...COMMENT_CARD_STYLE,
				margin: '4px 0',
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

// The one header a file gets, open or shut. Open, the highlighter renders it
// in its sticky slot in place of its own (change icon, name, counts), so the
// name that stays in view while the diff scrolls is also the one that folds
// it; shut, FileRow stands it in the same box by itself.
const FileHeader = ({
	file,
	expanded,
	onToggle,
	commentCount,
	reviewed,
	onReviewed,
}: {
	file: GuiCommitDiffFile;
	expanded: boolean;
	onToggle: () => void;
	commentCount: number;
	reviewed: boolean;
	onReviewed: (next: boolean) => void;
}) => {
	const [lit, setLit] = useState(false);

	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: 10,
				padding: '4px 10px 4px 4px',
			}}
		>
			<button
				onClick={onToggle}
				aria-expanded={expanded}
				onMouseEnter={() => setLit(true)}
				onMouseLeave={() => setLit(false)}
				onFocus={() => setLit(true)}
				onBlur={() => setLit(false)}
				style={{
					...disclosureStyle,
					flex: 1,
					minWidth: 0,
					width: 'auto',
					color: GUI_THEME.secondary,
					padding: '4px 6px',
					background: lit ? DISCLOSURE_HOVER_BG : 'transparent',
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
				{commentCount > 0 && (
					<span
						title={`${commentCount} comment${commentCount === 1 ? '' : 's'}`}
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
						{commentCount}
					</span>
				)}
				{/* Says why "Expand all" passed this one over. Only while shut: once
				    it is open the diff speaks for itself. */}
				{!expanded && isLargeDiff(file) && (
					<span
						data-testid="large-diff-badge"
						title={`${diffLineCount(
							file,
						).toLocaleString()} lines — left collapsed, open it to load the diff`}
						style={{
							flexShrink: 0,
							color: GUI_THEME.dim,
							fontSize: TEXT.label,
							whiteSpace: 'nowrap',
						}}
					>
						large diff
					</span>
				)}
			</button>
			<DiffStat insertions={file.insertions} deletions={file.deletions} />
			{/* Beside the toggle rather than inside it: ticking a file off must
			    not also fold or unfold it by accident. */}
			<Checkbox
				label="reviewed"
				checked={reviewed}
				onChange={onReviewed}
				activeColor={GUI_THEME.green}
			/>
		</div>
	);
};

export const FileRow = ({
	sha,
	file,
	expanded,
	onToggle,
	diffStyle,
	onAddComment,
	onFileTicket,
	comments,
	focusRange,
	reviewed,
	onReviewed,
}: {
	sha: string;
	file: GuiCommitDiffFile;
	expanded: boolean;
	onToggle: () => void;
	reviewed: boolean;
	onReviewed: (next: boolean) => void;
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

	const header = () => (
		<FileHeader
			file={file}
			expanded={expanded}
			onToggle={onToggle}
			commentCount={fileComments.length}
			reviewed={reviewed}
			onReviewed={onReviewed}
		/>
	);

	return (
		<div ref={rowRef} data-testid="file-row">
			{expanded ? (
				<>
					<FileDiffView
						file={file}
						diffStyle={diffStyle}
						selectedLines={hoveredRange ?? selection}
						onSelectionEnd={setSelection}
						lineAnnotations={lineAnnotations}
						renderCustomHeader={header}
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
			) : (
				// No diff mounted while shut — a large file left collapsed is
				// meant to cost nothing — so the header stands in the same box
				// by itself.
				<div style={DIFF_BOX_STYLE}>{header()}</div>
			)}
		</div>
	);
};
