import {useEffect, useMemo, useRef, useState} from 'react';
import {GuiSquashedDiff, GuiSquashedDiffFile} from '../lib/gui-state.model';
import {repoPathKey} from '../lib/repo-label';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {CODE_FONT} from '../lib/code-text.style';
import {
	hasDiffToShow,
	isLargeDiff,
	pathsOpenByDefault,
} from '../../../lib/utils/diff-size.js';
import {GuiComment} from '../lib/gui-state.model';
import {
	commentsByAnchor,
	FileTicketParams,
	isAdditionsSideComment,
} from '../lib/diff-selection';
import {useReviewedFiles} from '../lib/reviewed-files';
import {Button} from './Button';
import {Empty} from './FormPrimitives';
import {FileRow} from './FileRow';

// A ticket's commits can span repos, and two repos can each have a README.
const keyOf = (file: GuiSquashedDiffFile): string =>
	repoPathKey(file.path, file.repo);

// The ticket's whole change as one diff, a file once. Each row anchors to the
// ticket's last commit touching that file, so comments and ticks still work.

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
			// Amber takes a hex alpha; `line` is already rgba.
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

	// Grouped once, additions side only: deletions here number against a
	// different commit's file.
	const byAnchor = useMemo(
		() => commentsByAnchor(comments.filter(isAdditionsSideComment)),
		[comments],
	);
	// Opened once per answer, so a file shut by hand afterwards stays shut.
	const openedFor = useRef<string | null>(null);

	// Files open as they arrive, except large and reviewed ones.
	useEffect(() => {
		if (!diff || openedFor.current === diff.to) return;

		openedFor.current = diff.to;
		setExpandedFiles(
			new Set(
				// Reviewed files out first, so one that is shut anyway does not
				// spend the budget the rest share — see `pathsOpenByDefault`.
				pathsOpenByDefault(
					diff.files
						.filter(file => !isReviewed(file.sha, file.path))
						.map(file => ({...file, path: keyOf(file)})),
				),
			),
		);
	}, [diff]);

	if (loading) return <Empty>Compacting…</Empty>;
	if (error) return <Empty>{error}</Empty>;
	if (!diff) return <Empty>Nothing to compact yet</Empty>;
	if (diff.files.length === 0) {
		return <Empty>These commits changed no files</Empty>;
	}

	const expandablePaths = diff.files
		.filter(file => hasDiffToShow(file) && !isLargeDiff(file))
		.map(keyOf);
	const allExpanded =
		expandablePaths.length > 0
			? expandablePaths.every(path => expandedFiles.has(path))
			: diff.files.some(file => expandedFiles.has(keyOf(file)));

	const toggleFile = (path: string) =>
		setExpandedFiles(prev => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);

			return next;
		});

	// Ticking a file off is also how you say you are done looking at it, so it
	// folds; unticking it opens it back up. Same as the per-commit view.
	const reviewFile = (file: GuiSquashedDiffFile, next: boolean) => {
		setReviewed(file.sha, file.path, next);
		setExpandedFiles(prev => {
			const open = new Set(prev);
			if (next) open.delete(keyOf(file));
			else open.add(keyOf(file));

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

			{/* Says the diff isn't only this ticket's; each file's row says which. */}
			{!diff.contiguous && diff.overlappingPaths.length > 0 && (
				<Notice tone="amber">
					Another ticket&rsquo;s commits landed between these;{' '}
					{diff.overlappingPaths.length === 1
						? 'one file below carries their changes too, and is marked'
						: `${diff.overlappingPaths.length} files below carry their changes too, and are marked`}
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

			{diff.files.map(file => {
				// Another ticket's commit touched it, so no revision anchors these lines.
				const anchorable = !diff.overlappingPaths.includes(keyOf(file));

				return (
					<FileRow
						key={keyOf(file)}
						sha={file.sha}
						file={file}
						repo={file.repo}
						expanded={expandedFiles.has(keyOf(file))}
						onToggle={() => toggleFile(keyOf(file))}
						reviewed={isReviewed(file.sha, file.path)}
						onReviewed={next => reviewFile(file, next)}
						diffStyle={diffStyle}
						selectable={anchorable}
						shared={!anchorable}
						additionsOnly
						onAddComment={anchorable ? onAddComment : undefined}
						onFileTicket={anchorable ? onFileTicket : undefined}
						// Only where the shown content is the anchor commit's own.
						comments={anchorable ? byAnchor.get(file.sha) ?? [] : []}
					/>
				);
			})}
		</div>
	);
};
