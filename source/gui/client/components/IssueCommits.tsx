import React, {useEffect, useRef, useState} from 'react';
import {
	GuiComment,
	GuiCommitDiffFile,
	GuiRefCommitEntry,
} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {isLargeDiff} from '../../../lib/utils/diff-size.js';
import {useReviewedFiles} from '../lib/reviewed-files';
import {CopyRef} from './CopyRef';
import {Empty} from './FormPrimitives';
import {FileTicketParams, CommitFocus} from '../lib/diff-selection';
import {RAIL_WIDTH, RAIL_DOT_OFFSET, ROW_GAP} from '../lib/commit-row.style';
import {CommitRow} from './CommitRow';

export type CommitDiffState = {
	loading: boolean;
	error: string | null;
	files: GuiCommitDiffFile[] | null;
};

// Case-insensitive like the server's own match (getCommitsForRef) — a subject
// that doesn't actually carry the prefix (shouldn't happen, but the match
// isn't a hard guarantee client-side) is returned unchanged rather than mangled.
const stripRefPrefix = (subject: string, ref: string): string => {
	const prefix = `${ref} `;

	return subject.toUpperCase().startsWith(prefix.toUpperCase())
		? subject.slice(prefix.length)
		: subject;
};

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
	diffStyle,
	onAddComment,
	onFileTicket,
	comments,
	focus,
	expandAll = false,
}: {
	issueRef: string;
	commits: GuiRefCommitEntry[];
	loading: boolean;
	error: string | null;
	diffsBySha: Record<string, CommitDiffState>;
	onLoadDiff: (sha: string) => void;
	diffStyle: 'split' | 'unified';
	onAddComment?: (body: string) => void;
	onFileTicket?: (params: FileTicketParams) => void;
	comments: GuiComment[];
	// Where a comment permalink points, read from the URL by the caller.
	focus?: CommitFocus | null;
	// Open every commit as it appears — for a layout meant for reading rather
	// than scanning. Each is opened once, so collapsing it by hand afterwards
	// sticks.
	expandAll?: boolean;
}) => {
	const [expandedShas, setExpandedShas] = useState<Set<string>>(new Set());
	const [expandedFilesBySha, setExpandedFilesBySha] = useState<
		Record<string, Set<string>>
	>({});
	const {isReviewed, setReviewed} = useReviewedFiles();

	const autoOpenedShas = useRef(new Set<string>());
	const autoOpenedFiles = useRef(new Set<string>());

	// The reading layout opens every commit; either layout opens the only
	// commit, since with one there is nothing to choose between and the click
	// that would open it is just in the way. Once each, so collapsing it by
	// hand sticks.
	const openCommitsOnArrival = expandAll || commits.length === 1;

	useEffect(() => {
		if (!openCommitsOnArrival) return;

		const fresh = commits.filter(
			commit => !autoOpenedShas.current.has(commit.sha),
		);
		if (fresh.length === 0) return;

		for (const commit of fresh) autoOpenedShas.current.add(commit.sha);
		setExpandedShas(prev => {
			const next = new Set(prev);
			for (const commit of fresh) next.add(commit.sha);
			return next;
		});
		for (const commit of fresh) {
			const existing = diffsBySha[commit.sha];
			if (!existing || existing.error) onLoadDiff(commit.sha);
		}
	}, [openCommitsOnArrival, commits]);

	// A commit's files open as they arrive, in either layout: the diff is what
	// the reader came for. Once per commit, the moment its files first land,
	// so a file shut by hand afterwards stays shut — and a later "Expand all"
	// on one commit does not reach back into another.
	useEffect(() => {
		for (const commit of commits) {
			const files = diffsBySha[commit.sha]?.files;
			if (!files || autoOpenedFiles.current.has(commit.sha)) continue;

			autoOpenedFiles.current.add(commit.sha);
			setExpandedFilesBySha(prev => ({
				...prev,
				[commit.sha]: new Set([
					...(prev[commit.sha] ?? []),
					// A lockfile opened unasked is what stalls this view, so the
					// large ones stay shut until they are asked for by name. A file
					// already reviewed stays shut too: what is left open is what is
					// left to read.
					...files
						.filter(
							file => !isLargeDiff(file) && !isReviewed(commit.sha, file.path),
						)
						.map(file => file.path),
				]),
			}));
		}
	}, [commits, diffsBySha]);

	// Opens the commit and file a permalink names. Deliberately additive — it
	// never collapses anything the reader already had open, so following a
	// link into a tab you were already using doesn't throw your place away.
	// Keyed on the location's own values rather than object identity, which
	// the caller rebuilds from URL params on every render.
	const focusKey = focus ? `${focus.sha}:${focus.filePath ?? ''}` : null;

	useEffect(() => {
		if (!focus) return;

		setExpandedShas(prev =>
			prev.has(focus.sha) ? prev : new Set(prev).add(focus.sha),
		);

		const filePath = focus.filePath;
		if (filePath === undefined) return;

		setExpandedFilesBySha(prev =>
			prev[focus.sha]?.has(filePath)
				? prev
				: {
						...prev,
						[focus.sha]: new Set(prev[focus.sha] ?? []).add(filePath),
				  },
		);
	}, [focusKey]);

	// Separate from the expand effect above: the diff has to be fetched too,
	// and only when it isn't already loading or loaded.
	useEffect(() => {
		if (!focus) return;

		const existing = diffsBySha[focus.sha];
		if (!existing || existing.error) onLoadDiff(focus.sha);
	}, [focusKey]);

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

	// Ticking a file off is also how you say you are done looking at it, so
	// it folds; unticking it opens it back up for another look.
	const reviewFile = (sha: string, path: string, next: boolean) => {
		setReviewed(sha, path, next);
		setExpandedFilesBySha(prev => {
			const current = new Set(prev[sha] ?? []);
			if (next) {
				current.delete(path);
			} else {
				current.add(path);
			}
			return {...prev, [sha]: current};
		});
	};

	const setAllFilesExpanded = (
		sha: string,
		filePaths: string[],
		expand: boolean,
	) => {
		setExpandedFilesBySha(prev => ({
			...prev,
			[sha]: expand ? new Set(filePaths) : new Set(),
		}));
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
	// itself comes back newest-first. The ref prefix is stripped from the
	// displayed subject too: every commit in this list already matches
	// issueRef by definition, so repeating it on every row is pure noise.
	const ordered = [...commits]
		.sort((a, b) => a.time - b.time)
		.map(commit => ({
			...commit,
			subject: stripRefPrefix(commit.subject, issueRef),
		}));

	return (
		<div>
			{ordered.map((commit, index) => (
				<div key={commit.sha} style={{display: 'flex', marginBottom: ROW_GAP}}>
					{/* The rail: a dot per commit in the scrubber's own commit-series
					    color. Connected to the next only when they're truly adjacent in
					    the real history (precedingSha) — a broken chain (some other
					    ticket's commit landed between them) gets no line, just dots, so
					    the rail doesn't imply a continuity that isn't there.
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
						{index < ordered.length - 1 &&
							(ordered[index + 1].precedingSha === commit.sha ? (
								<div
									style={{
										position: 'absolute',
										left: '50%',
										top: RAIL_DOT_OFFSET,
										// Reaches the *next* dot, not just this row's own bottom
										// edge: that dot sits RAIL_DOT_OFFSET below the start of
										// its own row, past the ROW_GAP margin between the two.
										bottom: -(ROW_GAP + RAIL_DOT_OFFSET),
										width: 2,
										background: GUI_THEME.green,
										opacity: 0.4,
										transform: 'translateX(-50%)',
									}}
								/>
							) : (
								// A broken chain: some other ticket's commit sits between
								// these two in real history. Dotted and fainter rather than
								// no line at all — the two are still adjacent in this list,
								// just not in the underlying history.
								<div
									style={{
										position: 'absolute',
										left: '50%',
										top: RAIL_DOT_OFFSET,
										bottom: -(ROW_GAP + RAIL_DOT_OFFSET),
										width: 0,
										borderLeft: `2px dotted ${GUI_THEME.green}`,
										opacity: 0.25,
										transform: 'translateX(-50%)',
									}}
								/>
							))}
					</div>

					<div style={{flex: 1, minWidth: 0}}>
						<CommitRow
							commit={commit}
							diff={diffsBySha[commit.sha]}
							expanded={expandedShas.has(commit.sha)}
							onToggle={() => toggleCommit(commit.sha)}
							expandedFiles={expandedFilesBySha[commit.sha] ?? new Set()}
							onToggleFile={path => toggleFile(commit.sha, path)}
							onSetAllFilesExpanded={(paths, expand) =>
								setAllFilesExpanded(commit.sha, paths, expand)
							}
							reviewedFiles={{isReviewed, setReviewed: reviewFile}}
							diffStyle={diffStyle}
							onAddComment={onAddComment}
							onFileTicket={onFileTicket}
							comments={comments}
							focus={focus?.sha === commit.sha ? focus : null}
						/>
					</div>
				</div>
			))}
		</div>
	);
};
