import React, {useState} from 'react';
import {GuiComment, GuiRefCommitEntry} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {isLargeDiff} from '../../../lib/utils/diff-size.js';
import {ReviewedFiles} from '../lib/reviewed-files';
import {Button} from './Button';
import {CopyShaButton} from './CopyShaButton';
import {Empty} from './FormPrimitives';
import {IconChevronDown} from './IconChevronDown';
import {IconChevronRight} from './IconChevronRight';
import {FileTicketParams, CommitFocus} from '../lib/diff-selection';
import {
	COMMIT_HEADER_PADDING,
	disclosureStyle,
	DISCLOSURE_HOVER_BG,
} from '../lib/commit-row.style';
import {DiffStat} from './DiffStat';
import {FileRow} from './FileRow';
import {CommitDiffState} from './IssueCommits';

export const CommitRow = ({
	commit,
	diff,
	expanded,
	onToggle,
	expandedFiles,
	onToggleFile,
	onSetAllFilesExpanded,
	reviewedFiles,
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
	reviewedFiles: ReviewedFiles;
	diffStyle: 'split' | 'unified';
	onAddComment?: (body: string) => void;
	onFileTicket?: (params: FileTicketParams) => void;
	comments: GuiComment[];
	// Non-null only on the commit a permalink points at.
	focus?: CommitFocus | null;
}) => {
	const [hovered, setHovered] = useState(false);
	// Also tracks focus (not just mouse hover): the copy button is a real
	// nested <button>, so a keyboard user can Tab straight to it — without
	// this it would sit there focused but invisible (opacity 0) until Enter.
	const [focused, setFocused] = useState(false);
	const revealed = hovered || focused;

	// Large files are not part of "expand all", so the button reads its state
	// off the ones that are. The fallback covers a commit where every file is
	// large, so the button can still collapse what was opened by hand rather
	// than sitting there doing nothing.
	const expandablePaths = (diff?.files ?? [])
		.filter(file => !isLargeDiff(file))
		.map(file => file.path);
	const allExpandableExpanded =
		expandablePaths.length > 0
			? expandablePaths.every(path => expandedFiles.has(path))
			: (diff?.files ?? []).some(file => expandedFiles.has(file.path));

	return (
		<div
			data-testid="commit-card"
			style={{
				border: `1px solid ${GUI_THEME.line}`,
				borderRadius: 8,
				// Clip rather than hide, so the card rounds its corners without
				// becoming a scroll container — one would trap each file's sticky
				// header in a box that never scrolls.
				overflow: 'clip',
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
				style={{
					...disclosureStyle,
					padding: `${COMMIT_HEADER_PADDING}px 14px`,
					background: revealed ? DISCLOSURE_HOVER_BG : 'transparent',
				}}
			>
				{/* The caret leads, as it does on the file rows, so a row reads as
			    foldable and its state is plain. flexShrink: 0 because a tight
			    panel width would otherwise squeeze it toward invisible rather
			    than truncate the (already-shrinkable) subject further. */}
				<span style={{flexShrink: 0, display: 'flex'}}>
					{expanded ? (
						<IconChevronDown size={12} />
					) : (
						<IconChevronRight size={12} />
					)}
				</span>
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
				{/* The sha is lookup chrome, not part of reading the list, so it
			    sits at the far right and only appears on hover or once expanded —
			    reachable without a full expand, but not permanent clutter.
			    Always mounted, opacity-toggled rather than conditionally rendered:
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
									// Expanding skips the large ones; collapsing still takes
									// everything, including a large file opened by hand.
									onSetAllFilesExpanded(
										allExpandableExpanded ? [] : expandablePaths,
										!allExpandableExpanded,
									);
								}}
							>
								{allExpandableExpanded ? 'Collapse all' : 'Expand all'}
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
							reviewed={reviewedFiles.isReviewed(commit.sha, file.path)}
							onReviewed={next =>
								reviewedFiles.setReviewed(commit.sha, file.path, next)
							}
							diffStyle={diffStyle}
							onAddComment={onAddComment}
							onFileTicket={onFileTicket}
							comments={comments}
							focusRange={
								focus?.filePath === file.path &&
								focus.start !== undefined &&
								focus.end !== undefined &&
								focus.side &&
								focus.endSide
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
