import {useEffect, useRef, useState} from 'react';
import {DiffLineAnnotation, SelectedLineRange} from '@pierre/diffs/react';
import {GuiComment, GuiCommitDiffFile} from '../lib/gui-state.model';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {diffLineCount, isLargeDiff} from '../../../lib/utils/diff-size.js';
import {COMMENT_CARD_STYLE} from '../lib/comment-card.style';
import {dedent, formatSelectionLabel} from '../../../lib/utils/diff-comment.js';
import {timeAgo} from '../lib/gui-format.helper';
import {Checkbox} from './Checkbox';
import {CreateNodeModal} from './CreateNodeModal';
import {BinaryFileNotice, DIFF_BOX_STYLE, FileDiffView} from './DiffPanel';
import {IconChevronDown} from './IconChevronDown';
import {IconChevronRight} from './IconChevronRight';
import {IconComment} from './IconComment';
import {
	extractSnippet,
	DiffComment,
	findDiffCommentsForFile,
	FileTicketParams,
} from '../lib/diff-selection';
import {disclosureStyle} from '../lib/commit-row.style';
import {CODE_FONT} from '../lib/code-text.style';
import {DiffStat} from './DiffStat';
import {Chip} from './Chip';
import {RepoChip} from './RepoChip';
import {SelectionComposer} from './SelectionComposer';

// What a file's diff carries at a line: an existing comment, or the composer
// for the range being selected right now.
type RowAnnotation =
	| {kind: 'comment'; entry: DiffComment}
	| {kind: 'composer'; selection: SelectedLineRange};

// Drawn at a diff-selection comment's anchor line: author and note only; the
// full body is in the Comments tab.
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
				{meta.note || <em style={{color: GUI_THEME.dim}}>Commented</em>}
			</div>
		</div>
	);
};

// A file's one header, open or shut. Open, it takes the highlighter's sticky
// header slot; shut, it stands alone in the same box.
const FileHeader = ({
	file,
	repo,
	shared,
	expanded,
	onToggle,
	commentCount,
	reviewed,
	onReviewed,
}: {
	file: GuiCommitDiffFile;
	repo?: string;
	shared: boolean;
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
					background: lit ? GUI_THEME.hover : 'transparent',
				}}
			>
				{expanded ? (
					<IconChevronDown size={12} />
				) : (
					<IconChevronRight size={12} />
				)}
				<span
					style={{
						fontFamily: CODE_FONT,
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
					}}
				>
					{file.path}
				</span>
				{repo && <RepoChip repo={repo} />}
				{shared && (
					<Chip
						testId="shared-file"
						title="Another ticket's commits also changed this file between these. What is shown is both tickets' work; read it on the Commits view."
						style={{color: GUI_THEME.amber}}
					>
						Also other tickets
					</Chip>
				)}
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
						Large diff
					</span>
				)}
			</button>
			<DiffStat insertions={file.insertions} deletions={file.deletions} />
			{/* Beside the toggle rather than inside it: ticking a file off must
			    not also fold or unfold it by accident. */}
			<Checkbox
				label="Reviewed"
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
	repo,
	expanded,
	onToggle,
	diffStyle,
	onAddComment,
	onFileTicket,
	comments,
	focusRange,
	reviewed,
	onReviewed,
	selectable = true,
	shared = false,
	additionsOnly = false,
}: {
	// The commit comments, filed tickets and review ticks anchor to. In the
	// compacted diff, the ticket's last commit to touch this file.
	sha: string;
	file: GuiCommitDiffFile;
	// The registered repo the file is in, where a diff mixes repos.
	repo?: string;
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
	// False where an anchor would lie: a compacted file another ticket's commit touched.
	selectable?: boolean;
	// Another ticket's commit also changed this file in the compacted range.
	shared?: boolean;
	// The compacted diff's deletions side belongs to no commit, so only additions
	// are selectable.
	additionsOnly?: boolean;
}) => {
	const [selection, setSelection] = useState<SelectedLineRange | null>(null);
	// Held here rather than in the composer so re-dragging the range keeps
	// what was typed.
	const [note, setNote] = useState('');
	const rowRef = useRef<HTMLDivElement | null>(null);

	// The title of a ticket filed off the selection; null while the prompt is closed.
	const [ticketTitle, setTicketTitle] = useState<string | null>(null);
	// The range of the comment under the pointer, lit up so the reader can
	// see which lines it is about.
	const [hoveredRange, setHoveredRange] = useState<SelectedLineRange | null>(
		null,
	);

	const acceptSelection = (range: SelectedLineRange | null) => {
		// Clears the old selection's composer once a new drag starts.
		if (
			range &&
			additionsOnly &&
			(range.side === 'deletions' || range.endSide === 'deletions')
		) {
			return setSelection(null);
		}

		setSelection(range);
	};

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

	// Keyed by value: the range is rebuilt from URL params every render.
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

	// Everything the render props read beyond what the diff hands them; FileDiffView
	// is memoized on it, so a missing value freezes on screen.
	const renderKey = [
		expanded,
		reviewed,
		selectable,
		shared,
		additionsOnly,
		// What they say, not just how many: an edited note redraws.
		fileComments.map(entry => entry.comment.body).join('\u0000'),
		note,
		selection ? `${selection.start}-${selection.end}` : '',
		hoveredRange ? `${hoveredRange.start}-${hoveredRange.end}` : '',
		ticketTitle,
	].join('|');

	const header = () => (
		<FileHeader
			file={file}
			repo={repo}
			shared={shared}
			expanded={expanded}
			onToggle={onToggle}
			commentCount={fileComments.length}
			reviewed={reviewed}
			onReviewed={onReviewed}
		/>
	);

	// A file git won't diff (binary or `-diff` in .gitattributes) keeps its header
	// and comments, with a notice in place of the diff.
	if (file.isBinary) {
		return (
			<div ref={rowRef} data-testid="file-row">
				<div style={DIFF_BOX_STYLE}>
					{header()}
					{expanded ? <BinaryFileNotice framed={false} /> : null}
				</div>
				{expanded &&
					fileComments.map(entry => (
						<DiffCommentAnnotation
							key={entry.comment.id}
							entry={entry}
							onHover={() => {}}
						/>
					))}
			</div>
		);
	}

	return (
		<div ref={rowRef} data-testid="file-row">
			{expanded ? (
				<>
					<FileDiffView
						file={file}
						diffStyle={diffStyle}
						renderKey={renderKey}
						selectedLines={hoveredRange ?? selection}
						onSelectionEnd={selectable ? acceptSelection : undefined}
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
							confirmLabel="File ticket"
							title={ticketTitle}
							onChangeTitle={setTicketTitle}
							onCreate={fileTicket}
							onClose={() => setTicketTitle(null)}
						/>
					)}
				</>
			) : (
				// No diff mounted while shut, so the header stands alone.
				<div style={DIFF_BOX_STYLE}>{header()}</div>
			)}
		</div>
	);
};
