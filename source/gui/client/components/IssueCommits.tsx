import React, {useState} from 'react';
import {GuiCommitDiffFile, GuiCommitEntry} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
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
					height: 6,
					borderRadius: 3,
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

const FileRow = ({
	file,
	expanded,
	onToggle,
}: {
	file: GuiCommitDiffFile;
	expanded: boolean;
	onToggle: () => void;
}) => (
	<div style={{marginTop: 8}}>
		<button
			onClick={onToggle}
			aria-expanded={expanded}
			style={{...disclosureStyle, color: GUI_THEME.secondary, padding: '4px 0'}}
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

		{expanded && <FileDiffView file={file} />}
	</div>
);

const CommitRow = ({
	commit,
	diff,
	expanded,
	onToggle,
	expandedFiles,
	onToggleFile,
}: {
	commit: GuiCommitEntry;
	diff: CommitDiffState | undefined;
	expanded: boolean;
	onToggle: () => void;
	expandedFiles: Set<string>;
	onToggleFile: (path: string) => void;
}) => (
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
			aria-expanded={expanded}
			style={{...disclosureStyle, padding: '13px 14px'}}
		>
			{expanded ? (
				<IconChevronDown size={12} />
			) : (
				<IconChevronRight size={12} />
			)}
			<CopyShaButton sha={commit.sha} />
			<span
				style={{
					flex: 1,
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
				}}
			>
				{commit.subject}
			</span>
			<DiffStat insertions={commit.insertions} deletions={commit.deletions} />
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
					/>
				))}
			</div>
		)}
	</div>
);

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
}: {
	issueRef: string;
	commits: GuiCommitEntry[];
	loading: boolean;
	error: string | null;
	diffsBySha: Record<string, CommitDiffState>;
	onLoadDiff: (sha: string) => void;
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
	// itself comes back newest-first.
	const ordered = [...commits].sort((a, b) => a.time - b.time);

	return (
		<div>
			{ordered.map((commit, index) => (
				<div key={commit.sha} style={{display: 'flex', marginBottom: ROW_GAP}}>
					{/* The rail: a dot per commit in the scrubber's own commit-series
					    color, connected to the next by a line — so this list visibly
					    reads as the same timeline, not a disconnected view of it.
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
						{index < ordered.length - 1 && (
							<div
								style={{
									position: 'absolute',
									left: '50%',
									top: RAIL_DOT_OFFSET,
									bottom: -ROW_GAP,
									width: 2,
									background: GUI_THEME.green,
									opacity: 0.4,
									transform: 'translateX(-50%)',
								}}
							/>
						)}
					</div>

					<div style={{flex: 1, minWidth: 0}}>
						<CommitRow
							commit={commit}
							diff={diffsBySha[commit.sha]}
							expanded={expandedShas.has(commit.sha)}
							onToggle={() => toggleCommit(commit.sha)}
							expandedFiles={expandedFilesBySha[commit.sha] ?? new Set()}
							onToggleFile={path => toggleFile(commit.sha, path)}
						/>
					</div>
				</div>
			))}
		</div>
	);
};
