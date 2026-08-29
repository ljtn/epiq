import React from 'react';
import {DiffFileInput, FileContents, MultiFileDiff} from '@pierre/diffs/react';
import {GUI_THEME} from '../lib/gui-theme';
import {GuiCommitDiffFile} from '../lib/gui-state.model';
import {Button} from './Button';
import {CopyShaButton} from './CopyShaButton';
import {Empty} from './FormPrimitives';
import {FormHeader} from './FormHeader';
import {IconMaximize} from './IconMaximize';
import {IconMinimize} from './IconMinimize';

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

export const FileDiffView = ({
	file,
	diffStyle,
}: {
	file: GuiCommitDiffFile;
	diffStyle: 'split' | 'unified';
}) => (
	<div
		style={{
			marginBottom: 16,
			border: `1px solid ${GUI_THEME.line}`,
			borderRadius: 8,
			overflow: 'hidden',
		}}
	>
		<MultiFileDiff
			{...toDiffFileInput(file)}
			options={{diffStyle, theme: PIERRE_THEME}}
		/>
	</div>
);

// Icon-only, matching CopyShaButton's own footprint — a plain-text label
// ("Fullscreen"/"Collapse") would sit oddly next to a button with no label.
const FullscreenToggleButton = ({
	isFullscreen,
	onClick,
}: {
	isFullscreen: boolean;
	onClick: () => void;
}) => (
	<button
		type="button"
		title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
		onClick={onClick}
		style={{
			display: 'inline-flex',
			alignItems: 'center',
			flexShrink: 0,
			background: 'transparent',
			border: 'none',
			padding: 4,
			borderRadius: 4,
			cursor: 'pointer',
			color: GUI_THEME.dim,
			transition: 'color 120ms ease, background 120ms ease',
		}}
		onMouseEnter={event => {
			event.currentTarget.style.background = 'rgba(255,255,255,0.04)';
			event.currentTarget.style.color = GUI_THEME.accent;
		}}
		onMouseLeave={event => {
			event.currentTarget.style.background = 'transparent';
			event.currentTarget.style.color = GUI_THEME.dim;
		}}
	>
		{isFullscreen ? <IconMinimize size={12} /> : <IconMaximize size={12} />}
	</button>
);

export const DiffPanel = ({
	sha,
	files,
	loading,
	error,
	diffStyle,
	onClose,
	isFullscreen,
	toggleFullscreen,
}: {
	sha: string;
	files: GuiCommitDiffFile[] | null;
	loading: boolean;
	error: string | null;
	diffStyle: 'split' | 'unified';
	onClose: () => void;
	isFullscreen: boolean;
	toggleFullscreen: () => void;
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
				<FileDiffView key={file.path} file={file} diffStyle={diffStyle} />
			))}
	</>
);
