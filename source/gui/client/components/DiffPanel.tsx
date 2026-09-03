import React, {useState} from 'react';
import {
	DiffFileInput,
	DiffLineAnnotation,
	FileContents,
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

// A single dark theme: the app has no light mode to match (GUI_THEME is a
// fixed dark palette), so there is no pair to switch between.
const PIERRE_THEME = 'github-dark';

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

export const FileDiffView = <LAnnotation = undefined,>({
	file,
	diffStyle,
	selectedLines,
	onSelectionEnd,
	lineAnnotations,
	renderAnnotation,
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
}) => (
	<div
		style={{
			...CODE_TEXT_VARS,
			marginBottom: 16,
			border: `1px solid ${GUI_THEME.line}`,
			borderRadius: 8,
			overflow: 'hidden',
		}}
	>
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
			}}
			selectedLines={selectedLines}
			lineAnnotations={lineAnnotations}
			renderAnnotation={renderAnnotation}
		/>
	</div>
);

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
