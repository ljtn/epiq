import React, {useEffect, useRef, useState} from 'react';
import {GuiComment, GuiRefCommitEntry} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {pathsOpenByDefault} from '../../../lib/utils/diff-size.js';
import {useReviewedFiles} from '../lib/reviewed-files';
import {CopyRef} from './CopyRef';
import {Empty} from './FormPrimitives';
import {FileTicketParams, CommitFocus} from '../lib/diff-selection';
import {RAIL_WIDTH, RAIL_DOT_OFFSET, ROW_GAP} from '../lib/commit-row.style';
import {CommitRow} from './CommitRow';
import {CommitDiffState} from '../lib/use-issue-detail';

// Case-insensitive like the server's match; a subject without the prefix is unchanged.
const stripRefPrefix = (subject: string, refs: string[]): string => {
	const prefix = refs
		.map(ref => `${ref} `)
		.find(prefix => subject.toUpperCase().startsWith(prefix.toUpperCase()));

	return prefix ? subject.slice(prefix.length) : subject;
};

// Per commit, not a flattened file list: a file touched twice shows twice.
export const IssueCommits = ({
	issueRef,
	empty,
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
}: {
	// A ticket's list; a goal's has none, as each commit names its tickets.
	issueRef?: string;
	// What it says with no commits, where it is not a ticket's.
	empty?: React.ReactNode;
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
}) => {
	const [expandedShas, setExpandedShas] = useState<Set<string>>(new Set());
	const [expandedFilesBySha, setExpandedFilesBySha] = useState<
		Record<string, Set<string>>
	>({});
	const {isReviewed, setReviewed} = useReviewedFiles();

	const autoOpenedShas = useRef(new Set<string>());
	const autoOpenedFiles = useRef(new Set<string>());

	// A lone commit opens itself, once, so collapsing it sticks.
	const openCommitsOnArrival = commits.length === 1;

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

	// Each commit's files open as they first land, once, so later closes stick.
	useEffect(() => {
		for (const commit of commits) {
			const files = diffsBySha[commit.sha]?.files;
			if (!files || autoOpenedFiles.current.has(commit.sha)) continue;

			autoOpenedFiles.current.add(commit.sha);
			setExpandedFilesBySha(prev => ({
				...prev,
				[commit.sha]: new Set([
					...(prev[commit.sha] ?? []),
					// Reviewed files stay shut and don't spend the budget; the rest is up to
					// `pathsOpenByDefault`.
					...pathsOpenByDefault(
						files.filter(file => !isReviewed(commit.sha, file.path)),
					),
				]),
			}));
		}
	}, [commits, diffsBySha]);

	// Opens the commit and file a permalink names, additively. Keyed by value.
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

		// Retries a failed fetch too.
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
				{empty ?? (
					<>
						No linked commits. Add Epiq-Ref:{' '}
						<CopyRef refValue={issueRef ?? ''} /> to a commit body.
					</>
				)}
			</Empty>
		);
	}

	// Oldest first; the ref prefix is stripped from subjects.
	const ordered = [...commits]
		.sort((a, b) => a.time - b.time)
		.map(commit => ({
			...commit,
			subject: stripRefPrefix(
				commit.subject,
				commit.tickets ?? (issueRef ? [issueRef] : []),
			),
		}));

	return (
		<div>
			{ordered.map((commit, index) => (
				<div key={commit.sha} style={{display: 'flex', marginBottom: ROW_GAP}}>
					{/* The rail: a dot per commit, joined to the next. Stretches with the row,
					    so no measuring is needed. */}
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
										// Reaches the next row's dot.
										bottom: -(ROW_GAP + RAIL_DOT_OFFSET),
										width: 2,
										background: GUI_THEME.green,
										opacity: 0.4,
										transform: 'translateX(-50%)',
									}}
								/>
							) : (
								// Dotted and faint: another ticket's commit sits between these two in history.
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
							lead={
								commit.tickets && (
									<span
										data-testid="commit-tickets"
										style={{
											flexShrink: 0,
											fontSize: 10,
											color: GUI_THEME.dim,
										}}
									>
										{commit.tickets.join(' ')}
									</span>
								)
							}
						/>
					</div>
				</div>
			))}
		</div>
	);
};
