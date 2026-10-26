import React, {memo, useMemo, useState} from 'react';
import {
	DiffLineAnnotation,
	FileDiffMetadata,
	MultiFileDiff,
	SelectedLineRange,
} from '@pierre/diffs/react';
import {useDiffWrap} from '../lib/diff-wrap';
import {GUI_THEME, PROSE} from '../lib/gui-theme';
import {CODE_FONT, CODE_TEXT_VARS} from '../lib/code-text.style';
import {GuiCommitDiffFile} from '../lib/gui-state.model';
import {toDiffFileInput} from '../lib/diff-file-input';
import {
	diffLineCount,
	isLargeDiff,
	openableByDefault,
} from '../../../lib/utils/diff-size.js';
import {Button} from './Button';
import {CopyShaButton} from './CopyShaButton';
import {Empty} from './FormPrimitives';
import {FormHeader} from './FormHeader';
import {CommitBody} from './CommitBody';
import {FullscreenToggleButton} from './FullscreenToggleButton';
import {PanelDockMenu} from './PanelDockMenu';
import {AsideDock} from '../lib/aside-dock';
import {EPIQ_DIFF_THEME} from '../lib/diff-theme';
import {useDiffWorkersUsable} from '../lib/diffs-worker-pool';

// The app is dark only, so one theme (see lib/diff-theme).
const PIERRE_THEME = EPIQ_DIFF_THEME;

// The box a file's diff sits in. Shared with whatever stands in for the diff
// while it is collapsed, so a file looks the same shut as open.
export const DIFF_BOX_STYLE: React.CSSProperties = {
	...CODE_TEXT_VARS,
	marginBottom: 16,
	border: `1px solid ${GUI_THEME.line}`,
	borderRadius: 8,
	// Clip, not hidden: a scroll container would stop the header sticking.
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
	// Undefined leaves line selection off.
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
	 * What the render props close over, as a string; a change re-renders the
	 * memoized diff. Omit it when they close over nothing.
	 */
	renderKey?: string;
}) => {
	const [wrap] = useDiffWrap();

	return (
		<div style={DIFF_BOX_STYLE}>
			<MultiFileDiff
				{...toDiffFileInput(file)}
				// Falls back to the main thread where workers are unusable (see lib/diffs-worker-pool).
				disableWorkerPool={!useDiffWorkersUsable()}
				options={{
					diffStyle,
					theme: PIERRE_THEME,
					enableLineSelection: onSelectionEnd !== undefined,
					controlledSelection: onSelectionEnd !== undefined,
					onLineSelectionEnd: onSelectionEnd,
					// Shows lines are selectable before anyone tries dragging.
					lineHoverHighlight:
						onSelectionEnd !== undefined ? 'both' : 'disabled',
					// Keeps a file's name pinned while any of its diff is on screen.
					stickyHeader: true,
					overflow: wrap ? 'wrap' : 'scroll',
				}}
				selectedLines={selectedLines}
				lineAnnotations={lineAnnotations}
				renderAnnotation={renderAnnotation}
				renderCustomHeader={renderCustomHeader}
			/>
		</div>
	);
};

// Compared by value: it is rebuilt from URL params on every render.
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

// Metadata isn't compared; `renderKey` says when it changed.
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
 * Memoized by value: every sync rebuilds the props, and below sit the
 * highlighter and a node per line. `renderKey` keeps the render props fresh.
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

/**
 * Stands in for a binary file, which has no diff. `framed` off where the
 * caller already draws the box and name.
 */
export const BinaryFileNotice = ({
	path,
	framed = true,
}: {
	path?: string;
	framed?: boolean;
}) => (
	<div
		data-testid="binary-file-notice"
		style={{
			display: 'flex',
			alignItems: 'center',
			justifyContent: framed ? 'space-between' : 'flex-start',
			gap: 12,
			padding: '10px 12px',
			color: GUI_THEME.dim,
			fontSize: 12,
			...(framed
				? {
						marginBottom: 16,
						border: `1px solid ${GUI_THEME.line}`,
						borderRadius: 8,
				  }
				: {borderTop: `1px solid ${GUI_THEME.line}`}),
		}}
	>
		{framed && path !== undefined && (
			<span
				style={{
					fontFamily: CODE_FONT,
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
				}}
			>
				{path}
			</span>
		)}
		<span style={{flexShrink: 0}}>Binary file</span>
	</div>
);

// Shut until asked for, like the commit list's large files. `open` is the
// whole commit's answer (see `openableByDefault`).
const PanelFile = ({
	file,
	diffStyle,
	open,
}: {
	file: GuiCommitDiffFile;
	diffStyle: 'split' | 'unified';
	open: boolean;
}) => {
	const [shown, setShown] = useState(false);

	// Before the open/shut question, which does not apply: there is no diff
	// behind this one to reveal.
	if (file.isBinary) return <BinaryFileNotice path={file.path} />;

	if (shown || open) {
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
					fontFamily: CODE_FONT,
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
				{/* Its own size only when that's why it's shut. */}
				{isLargeDiff(file)
					? `${diffLineCount(file).toLocaleString()} lines`
					: 'Large commit'}
				<Button variant="ghost" onClick={() => setShown(true)}>
					Show diff
				</Button>
			</span>
		</div>
	);
};

// One decision for the whole commit, taken once: which files are cheap enough
// to open unasked, given the ones already open above them.
const PanelFiles = ({
	files,
	diffStyle,
}: {
	files: GuiCommitDiffFile[];
	diffStyle: 'split' | 'unified';
}) => {
	const open = useMemo(() => openableByDefault(files), [files]);

	return (
		<>
			{files.map((file, index) => (
				<PanelFile
					key={file.path}
					file={file}
					diffStyle={diffStyle}
					open={open[index] ?? false}
				/>
			))}
		</>
	);
};

export const DiffPanel = ({
	sha,
	subject,
	body,
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
	subject: string;
	body?: string;
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

		{subject && (
			<div
				data-testid="commit-subject"
				style={{
					...PROSE,
					color: GUI_THEME.primary,
					overflowWrap: 'anywhere',
				}}
			>
				{subject}
			</div>
		)}
		{body && <CommitBody body={body} />}

		{loading && <Empty>Loading diff…</Empty>}
		{!loading && error && <Empty>{error}</Empty>}
		{!loading && !error && files?.length === 0 && <Empty>No changes</Empty>}

		{!loading && !error && files && (
			<PanelFiles files={files} diffStyle={diffStyle} />
		)}
	</>
);
