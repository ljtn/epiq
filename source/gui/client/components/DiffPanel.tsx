import React, {memo, useState} from 'react';
import {
	DiffFileInput,
	DiffLineAnnotation,
	FileContents,
	FileDiffMetadata,
	MultiFileDiff,
	SelectedLineRange,
} from '@pierre/diffs/react';
import {GUI_THEME} from '../lib/gui-theme';
import {CODE_TEXT_VARS} from '../lib/code-text.style';
import {GuiCommitDiffFile} from '../lib/gui-state.model';
import {diffLineCount, isLargeDiff} from '../../../lib/utils/diff-size.js';
import {Button} from './Button';
import {CopyShaButton} from './CopyShaButton';
import {Empty} from './FormPrimitives';
import {FormHeader} from './FormHeader';
import {FullscreenToggleButton} from './FullscreenToggleButton';
import {PanelDockMenu} from './PanelDockMenu';
import {AsideDock} from '../lib/aside-dock';
import {EPIQ_DIFF_THEME} from '../lib/diff-theme';

// A single dark theme: the app has no light mode to match (GUI_THEME is a
// fixed dark palette), so there is no pair to switch between. github-dark with
// its comments brought forward — see lib/diff-theme.
const PIERRE_THEME = EPIQ_DIFF_THEME;

// Independently-nullable before/after strings don't structurally match
// DiffFileInput's three-branch union (it forbids "both null"), so this picks
// the one branch that fits rather than letting TypeScript infer a wider type.
const toDiffFileInput = (file: GuiCommitDiffFile): DiffFileInput => {
	const oldFile: FileContents = {name: file.path, contents: file.before};
	const newFile: FileContents = {name: file.path, contents: file.after};

	// Empty means "did not exist at this revision", same convention the server
	// side already uses (a missing git blob reads as ''). A genuinely empty
	// file on one side, that also exists, is indistinguishable from this and
	// renders as added/deleted rather than an empty-content change.
	if (file.before === '' && file.after !== '') return {oldFile: null, newFile};
	if (file.after === '' && file.before !== '') return {oldFile, newFile: null};

	return {oldFile, newFile};
};

// The box a file's diff sits in. Shared with whatever stands in for the diff
// while it is collapsed, so a file looks the same shut as open.
export const DIFF_BOX_STYLE: React.CSSProperties = {
	...CODE_TEXT_VARS,
	marginBottom: 16,
	border: `1px solid ${GUI_THEME.line}`,
	borderRadius: 8,
	// Clip, not hidden: both round the corners off the diff, but `hidden`
	// makes this a scroll container, and the header inside then sticks to
	// a box that never scrolls — which is to say, not at all.
	overflow: 'clip',
};

const FileDiffViewInner = <LAnnotation = undefined,>({
	file,
	diffStyle,
	selectedLines,
	onSelectionEnd,
	lineAnnotations,
	renderAnnotation,
	renderCustomHeader,
}: {
	file: GuiCommitDiffFile;
	diffStyle: 'split' | 'unified';
	// Undefined (the DiffPanel scrubber-dot flow's default) leaves selection
	// off entirely — enabling it costs nothing there, but there's no ticket
	// for a selection to attach to in that flow, so it stays opt-in.
	selectedLines?: SelectedLineRange | null;
	onSelectionEnd?: (range: SelectedLineRange | null) => void;
	lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
	renderAnnotation?: (
		annotation: DiffLineAnnotation<LAnnotation>,
	) => React.ReactNode;
	// Replaces the highlighter's own file header (name, change icon, counts)
	// with the caller's, in the same sticky slot.
	renderCustomHeader?: (fileDiff: FileDiffMetadata) => React.ReactNode;
	/**
	 * Everything the two render props above close over, as a string.
	 *
	 * This component is memoized, and a render prop is a closure: skipping a
	 * re-render would otherwise leave the header and the annotations drawn from
	 * whatever state they captured last. The caller says here what they depend
	 * on — a file's expanded and reviewed flags, the note being typed — and a
	 * change to it is what lets the re-render through. Omitted, the diff never
	 * re-renders for anything but its own data, which is right for a caller
	 * whose render props close over nothing.
	 */
	renderKey?: string;
}) => (
	<div style={DIFF_BOX_STYLE}>
		<MultiFileDiff
			{...toDiffFileInput(file)}
			options={{
				diffStyle,
				theme: PIERRE_THEME,
				enableLineSelection: onSelectionEnd !== undefined,
				controlledSelection: onSelectionEnd !== undefined,
				onLineSelectionEnd: onSelectionEnd,
				// Signals a line is selectable before the user has tried dragging —
				// otherwise the whole selection/comment feature is invisible until
				// discovered by accident.
				lineHoverHighlight: onSelectionEnd !== undefined ? 'both' : 'disabled',
				// Keeps the file's name against the top of the panel for as long as
				// any of its diff is on screen. A commit opens every file it touched
				// into one column, so without this a scrolled-to hunk belongs to
				// whichever name has already gone past.
				stickyHeader: true,
			}}
			selectedLines={selectedLines}
			lineAnnotations={lineAnnotations}
			renderAnnotation={renderAnnotation}
			renderCustomHeader={renderCustomHeader}
		/>
	</div>
);

// What a selection is, for comparison: two line numbers and the sides they
// belong to. Compared by value because it is rebuilt from URL params on every
// render, so its identity means nothing.
const sameSelection = (
	a: SelectedLineRange | null | undefined,
	b: SelectedLineRange | null | undefined,
): boolean =>
	a === b ||
	(!!a &&
		!!b &&
		a.start === b.start &&
		a.end === b.end &&
		a.side === b.side &&
		a.endSide === b.endSide);

// An annotation is a place plus a thing to draw there. The metadata is
// deliberately not compared: what it holds is the caller's, and `renderKey` is
// where the caller declares that it changed.
const sameAnnotations = <L,>(
	a: DiffLineAnnotation<L>[] | undefined,
	b: DiffLineAnnotation<L>[] | undefined,
): boolean => {
	if (a === b) return true;
	if (!a || !b || a.length !== b.length) return false;

	return a.every(
		(annotation, index) =>
			annotation.side === b[index]?.side &&
			annotation.lineNumber === b[index]?.lineNumber,
	);
};

/**
 * Memoized, because this is the expensive boundary in the whole client: below
 * it sits the syntax highlighter and one DOM node per line of the file.
 *
 * The board broadcasts its whole state on every sync, and a sync that changed
 * nothing about this ticket still rebuilt the arrays this tree is drawn from —
 * measured at four full re-renders of every open file per broadcast, for a
 * board that had not changed. None of the props that matter had changed; only
 * their identities had.
 *
 * So the comparison is by value, and `renderKey` carries what the render props
 * close over. Without that key a memo here would be quietly wrong rather than
 * merely useless: the header and the composer are closures, and skipping their
 * re-render would freeze them.
 */
export const FileDiffView = memo(FileDiffViewInner, (previous, next) => {
	return (
		previous.file === next.file &&
		previous.diffStyle === next.diffStyle &&
		previous.renderKey === next.renderKey &&
		sameSelection(previous.selectedLines, next.selectedLines) &&
		sameAnnotations(previous.lineAnnotations, next.lineAnnotations)
	);
	// A generic component loses its type parameter through `memo`; the cast
	// hands it back, so callers still infer their own annotation metadata.
}) as typeof FileDiffViewInner;

// This panel has no per-file disclosure to hide behind — it opens every file
// of a commit at once — so a lockfile here stalls the view with no action from
// the reader at all. Collapsed until asked for, the way the commit list leaves
// its own large files shut.
const PanelFile = ({
	file,
	diffStyle,
}: {
	file: GuiCommitDiffFile;
	diffStyle: 'split' | 'unified';
}) => {
	const [shown, setShown] = useState(false);

	if (shown || !isLargeDiff(file)) {
		return <FileDiffView file={file} diffStyle={diffStyle} />;
	}

	return (
		<div
			data-testid="large-diff-notice"
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				gap: 12,
				marginBottom: 16,
				padding: '10px 12px',
				border: `1px solid ${GUI_THEME.line}`,
				borderRadius: 8,
				color: GUI_THEME.dim,
				fontSize: 12,
			}}
		>
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
			<span
				style={{flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8}}
			>
				{diffLineCount(file).toLocaleString()} lines
				<Button variant="ghost" onClick={() => setShown(true)}>
					Show diff
				</Button>
			</span>
		</div>
	);
};

export const DiffPanel = ({
	sha,
	files,
	loading,
	error,
	diffStyle,
	onClose,
	isFullscreen,
	toggleFullscreen,
	dock,
	onDock,
}: {
	sha: string;
	files: GuiCommitDiffFile[] | null;
	loading: boolean;
	error: string | null;
	diffStyle: 'split' | 'unified';
	onClose: () => void;
	isFullscreen: boolean;
	toggleFullscreen: () => void;
	dock: AsideDock;
	onDock: (next: AsideDock) => void;
}) => (
	<>
		<FormHeader>
			<span
				style={{
					color: GUI_THEME.secondary,
					fontSize: 10,
					textTransform: 'uppercase',
					letterSpacing: '0.08em',
				}}
			>
				Commit
			</span>

			<div style={{display: 'flex', alignItems: 'center', gap: 2}}>
				<CopyShaButton sha={sha} />
				<PanelDockMenu dock={dock} onDock={onDock} />
				<FullscreenToggleButton
					isFullscreen={isFullscreen}
					onClick={toggleFullscreen}
				/>
				<Button variant="ghost" onClick={onClose}>
					×
				</Button>
			</div>
		</FormHeader>

		{loading && <Empty>Loading diff…</Empty>}
		{!loading && error && <Empty>{error}</Empty>}
		{!loading && !error && files?.length === 0 && <Empty>No changes.</Empty>}

		{!loading &&
			!error &&
			files?.map(file => (
				<PanelFile key={file.path} file={file} diffStyle={diffStyle} />
			))}
	</>
);
