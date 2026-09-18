import {useEffect, useRef, useState} from 'react';
import {GuiSquashedDiff} from '../lib/gui-state.model';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {CODE_FONT} from '../lib/code-text.style';
import {isLargeDiff} from '../../../lib/utils/diff-size.js';
import {GuiComment} from '../lib/gui-state.model';
import {FileTicketParams} from '../lib/diff-selection';
import {useReviewedFiles} from '../lib/reviewed-files';
import {Button} from './Button';
import {Empty} from './FormPrimitives';
import {FileRow} from './FileRow';

// The ticket's whole change as one diff, the way a pull request reads it: a
// file appears once, showing where it started and where it ended up, rather
// than once per commit that touched it on the way.
//
// The same FileRow the per-commit view uses, minus the commit rail above it —
// the grouping is the only difference, and that includes the things anchored
// to a commit. Each row carries the last of the ticket's commits to touch that
// file, which is what a comment, a filed ticket and a review tick hang off, so
// all three work here exactly as they do per commit (TCYD699).

const Notice = ({
	tone,
	children,
}: {
	tone: 'amber' | 'dim';
	children: React.ReactNode;
}) => (
	<div
		data-testid="squashed-diff-notice"
		style={{
			marginBottom: 10,
			padding: '6px 10px',
			borderRadius: 6,
			// The amber is a hex colour and takes a hex alpha; `line` is already
			// an rgba and would become nonsense with one appended — which is what
			// it was, so the quieter notice drew with no border at all.
			border: `1px solid ${
				tone === 'amber' ? `${GUI_THEME.amber}33` : GUI_THEME.line
			}`,
			background: GUI_THEME.panel2,
			color: tone === 'amber' ? GUI_THEME.amber : GUI_THEME.secondary,
			fontSize: TEXT.meta,
			lineHeight: 1.5,
		}}
	>
		{children}
	</div>
);

export const SquashedDiff = ({
	diff,
	loading,
	error,
	diffStyle,
	onAddComment,
	onFileTicket,
	comments,
}: {
	diff: GuiSquashedDiff | null;
	loading: boolean;
	error: string | null;
	diffStyle: 'split' | 'unified';
	onAddComment?: (body: string) => void;
	onFileTicket?: (params: FileTicketParams) => void;
	comments: GuiComment[];
}) => {
	const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
	const {isReviewed, setReviewed} = useReviewedFiles();
	// Opened once per answer, so a file shut by hand afterwards stays shut.
	const openedFor = useRef<string | null>(null);

	// The same bargain the per-commit view strikes: the diff is what the reader
	// came for, so files open as they arrive — except the large ones, which are
	// what stalls this view and stay shut until asked for by name.
	useEffect(() => {
		if (!diff || openedFor.current === diff.to) return;

		openedFor.current = diff.to;
		setExpandedFiles(
			new Set(
				diff.files.filter(file => !isLargeDiff(file)).map(file => file.path),
			),
		);
	}, [diff]);

	if (loading) return <Empty>Compacting…</Empty>;
	if (error) return <Empty>{error}</Empty>;
	if (!diff) return <Empty>Nothing to compact yet.</Empty>;
	if (diff.files.length === 0) {
		return <Empty>These commits changed no files.</Empty>;
	}

	const expandablePaths = diff.files
		.filter(file => !isLargeDiff(file))
		.map(file => file.path);
	const allExpanded =
		expandablePaths.length > 0
			? expandablePaths.every(path => expandedFiles.has(path))
			: diff.files.some(file => expandedFiles.has(file.path));

	const toggleFile = (path: string) =>
		setExpandedFiles(prev => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);

			return next;
		});

	// Ticking a file off is also how you say you are done looking at it, so it
	// folds; unticking it opens it back up. Same as the per-commit view.
	const reviewFile = (sha: string, path: string, next: boolean) => {
		setReviewed(sha, path, next);
		setExpandedFiles(prev => {
			const open = new Set(prev);
			if (next) open.delete(path);
			else open.add(path);

			return open;
		});
	};

	return (
		<div>
			<div
				style={{
					display: 'flex',
					alignItems: 'baseline',
					gap: 8,
					marginBottom: 10,
					fontFamily: CODE_FONT,
					fontSize: TEXT.meta,
					color: GUI_THEME.dim2,
				}}
			>
				<span>
					{diff.commits} commit{diff.commits === 1 ? '' : 's'},{' '}
					{diff.files.length} file{diff.files.length === 1 ? '' : 's'}
				</span>
				<span style={{flex: 1}} />
				{diff.files.length > 1 && (
					<Button
						variant="ghost"
						onClick={() =>
							setExpandedFiles(
								allExpanded ? new Set() : new Set(expandablePaths),
							)
						}
					>
						{allExpanded ? 'Collapse all' : 'Expand all'}
					</Button>
				)}
			</div>

			{/* Said plainly rather than left to be discovered: the reader is
			    looking at a diff that is not only this ticket's, and which files
			    those are is the only part they can act on. */}
			{!diff.contiguous && diff.overlappingPaths.length > 0 && (
				<Notice tone="amber">
					Another ticket&rsquo;s commits landed between these, and{' '}
					{diff.overlappingPaths.length === 1
						? 'one file below carries'
						: `${diff.overlappingPaths.length} files below carry`}{' '}
					their changes too:{' '}
					<span style={{fontFamily: CODE_FONT}}>
						{diff.overlappingPaths.join(', ')}
					</span>
					. Read those on the Commits view.
				</Notice>
			)}

			{/* The interleaving happened, but missed every file this ticket
			    touched — so the diff is exact, and saying so is worth a line. */}
			{!diff.contiguous && diff.overlappingPaths.length === 0 && (
				<Notice tone="dim">
					Another ticket&rsquo;s commits landed between these, but touched no
					file this one did — so this diff is still only this ticket&rsquo;s.
				</Notice>
			)}

			{diff.files.map(file => (
				<FileRow
					key={file.path}
					sha={file.sha}
					file={file}
					expanded={expandedFiles.has(file.path)}
					onToggle={() => toggleFile(file.path)}
					reviewed={isReviewed(file.sha, file.path)}
					onReviewed={next => reviewFile(file.sha, file.path, next)}
					diffStyle={diffStyle}
					onAddComment={onAddComment}
					onFileTicket={onFileTicket}
					comments={comments}
				/>
			))}
		</div>
	);
};
