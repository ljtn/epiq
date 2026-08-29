import React, {useState} from 'react';
import {GuiCommitDiffFile, GuiCommitEntry} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {Empty} from './FormPrimitives';
import {FileDiffView} from './DiffPanel';
import {IconChevronDown} from './IconChevronDown';
import {IconChevronRight} from './IconChevronRight';

export type CommitDiffState = {
	loading: boolean;
	error: string | null;
	files: GuiCommitDiffFile[] | null;
};

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
			marginBottom: 10,
			border: `1px solid ${GUI_THEME.line}`,
			borderRadius: 8,
			overflow: 'hidden',
		}}
	>
		<button
			onClick={onToggle}
			aria-expanded={expanded}
			style={{...disclosureStyle, padding: '8px 10px'}}
		>
			{expanded ? (
				<IconChevronDown size={12} />
			) : (
				<IconChevronRight size={12} />
			)}
			<span
				style={{color: GUI_THEME.dim, fontFamily: 'ui-monospace, monospace'}}
			>
				{commit.sha.slice(0, 7)}
			</span>
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
		</button>

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
	commits,
	loading,
	error,
	diffsBySha,
	onLoadDiff,
}: {
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
		return <Empty>No commits reference this ticket yet.</Empty>;
	}

	// Oldest first, reading top-to-bottom as the story unfolded — the log
	// itself comes back newest-first.
	const ordered = [...commits].sort((a, b) => a.time - b.time);

	return (
		<div>
			{ordered.map(commit => (
				<CommitRow
					key={commit.sha}
					commit={commit}
					diff={diffsBySha[commit.sha]}
					expanded={expandedShas.has(commit.sha)}
					onToggle={() => toggleCommit(commit.sha)}
					expandedFiles={expandedFilesBySha[commit.sha] ?? new Set()}
					onToggleFile={path => toggleFile(commit.sha, path)}
				/>
			))}
		</div>
	);
};
