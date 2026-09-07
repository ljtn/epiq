// Everything the ticket panel needs that the board's own state does not carry:
// the description and comment bodies, the ticket's commits, and the diff of any
// commit opened in its Code tab.
//
// Three fetches, three replies and three pieces of state that were spread
// across the component rendering the panel. They belong together — each is
// asked for when the selected ticket changes, and each is thrown away when it
// changes again.

import {useCallback, useEffect, useState} from 'react';
// Types only, from a module that declares nothing but types and imports
// nothing at all — so reading the server's own shape here costs the client
// bundle nothing and cannot drag Node code across the boundary.
import {IssueStats} from '../../../lib/stats/issue-stats.model.js';
import {getResultValue} from './gui-state-helper';
import {
	GuiComment,
	GuiCommitDiff,
	GuiCommitDiffFile,
	GuiIssueHistoryEntry,
	GuiRefCommitEntry,
} from './gui-state.model';

export type IssueDetail = {
	issueId: string;
	description: string;
	comments: GuiComment[];
	history: GuiIssueHistoryEntry[];
};

export type IssueCommits = {
	issueId: string;
	loading: boolean;
	error: string | null;
	commits: GuiRefCommitEntry[];
};

export type IssueStatsState = {
	issueId: string;
	// What this answer was computed from: the ticket's newest sha, or an empty
	// string when it has no commits. A change means the answer is stale.
	signature: string;
	loading: boolean;
	error: string | null;
	stats: IssueStats | null;
};

/**
 * Whether the Stats tab has to ask again.
 *
 * Nothing on screen: yes. A different ticket, or the same one with a new
 * newest commit: yes, what is held describes something else. An answer that
 * failed: yes — a failure is not an answer, and without this the tab would
 * show the same error until the reader switched tickets and back. Otherwise
 * no: a ticket's stats are a function of its commits, and those have not moved.
 */
export const needsStats = (
	held: IssueStatsState | null,
	issueId: string,
	signature: string,
): boolean =>
	held === null ||
	held.issueId !== issueId ||
	held.signature !== signature ||
	held.error !== null;

export type CommitDiffState = {
	loading: boolean;
	error: string | null;
	files: GuiCommitDiffFile[] | null;
};

export type IssueDetailPanel = {
	detail: IssueDetail | null;
	commits: IssueCommits | null;
	stats: IssueStatsState | null;
	// Asked for when the Stats tab opens rather than on every ticket, since it
	// costs a git scan of every commit the ticket owns and most tickets are
	// opened to be read, not measured.
	loadStats: (issueId: string, signature: string) => void;
	commitDiffs: Record<string, CommitDiffState>;
	loadCommitDiff: (sha: string) => void;
	// An optimistic edit to the comments on screen, before the board's own state
	// catches up with the change.
	updateComments: (
		issueId: string,
		update: (comments: GuiComment[]) => GuiComment[],
	) => void;
	// Handed every frame; it takes the three that are its own and ignores the
	// rest. Deliberately not exclusive — `commit:diff:result` is also the
	// scrubber's, whose dot opens a diff in a panel of its own.
	onMessage: (message: any) => void;
};

export const useIssueDetail = ({
	issueId,
	boardState,
	paused,
	sendRaw,
}: {
	issueId: string | null;
	// Re-read when the board changes: a comment or a title edit lands as board
	// state, and the panel's own copy would otherwise go stale.
	boardState: unknown;
	// A movie is a state broadcast per frame, for a panel that is not even on
	// screen.
	paused: boolean;
	sendRaw: (message: unknown) => void;
}): IssueDetailPanel => {
	const [detail, setDetail] = useState<IssueDetail | null>(null);
	const [commits, setCommits] = useState<IssueCommits | null>(null);
	// Kept for the session and keyed by sha: a sha's diff is the same on any
	// ticket, and clearing per ticket raced a Code tab that requests a diff on
	// mount, wiping the request's entry so its reply had nothing to land in.
	const [commitDiffs, setCommitDiffs] = useState<
		Record<string, CommitDiffState>
	>({});

	useEffect(() => {
		if (!issueId) {
			setDetail(null);
			return;
		}

		if (paused) return;

		sendRaw({type: 'issue:get', payload: {issueId}});
	}, [issueId, boardState, paused, sendRaw]);

	// Separate from the fetch above, which re-runs on every board change: the
	// commit list comes from git, not the event log, so a board change is no
	// reason to rescan it.
	useEffect(() => {
		if (!issueId) {
			setCommits(null);
			return;
		}

		setCommits({issueId, loading: true, error: null, commits: []});
		sendRaw({type: 'issue:commits:get', payload: {issueId}});
	}, [issueId, sendRaw]);

	const [stats, setStats] = useState<IssueStatsState | null>(null);

	// Cleared on a ticket change rather than refetched: the tab the reader is
	// on decides whether the next one is measured at all.
	useEffect(() => {
		setStats(null);
	}, [issueId]);

	// Asking is only ever "put this ticket into loading"; the request itself is
	// the effect below.
	//
	// `signature` is what the answer was computed from — the ticket's newest
	// sha. A ticket's stats are a function of its commits, so an unchanged
	// signature asks for nothing and a new commit on the open ticket asks
	// again. An answer that failed is always retried: it is not an answer.
	const loadStats = useCallback((id: string, signature: string) => {
		setStats(prev =>
			needsStats(prev, id, signature)
				? {
						issueId: id,
						signature,
						loading: true,
						error: null,
						stats: null,
				  }
				: prev,
		);
	}, []);

	useEffect(() => {
		if (!stats?.loading) return;

		sendRaw({type: 'issue:stats:get', payload: {issueId: stats.issueId}});
	}, [stats?.issueId, stats?.signature, stats?.loading, sendRaw]);

	const loadCommitDiff = useCallback(
		(sha: string) => {
			setCommitDiffs(prev => ({
				...prev,
				[sha]: {loading: true, error: null, files: null},
			}));
			sendRaw({type: 'commit:diff:get', payload: {sha}});
		},
		[sendRaw],
	);

	const updateComments = useCallback(
		(id: string, update: (comments: GuiComment[]) => GuiComment[]) => {
			setDetail(prev =>
				prev && prev.issueId === id
					? {...prev, comments: update(prev.comments)}
					: prev,
			);
		},
		[],
	);

	const onMessage = useCallback((message: any) => {
		if (message.type === 'issue') {
			const next = getResultValue<IssueDetail>(message.payload);
			if (next) setDetail(next);
			return;
		}

		if (message.type === 'issue:commits:result') {
			// Wrapped with the issueId it was asked for: switching tickets with the
			// Code tab open can leave an older ticket's request in flight, and a
			// failed Result carries no issueId to tell whose reply this is.
			const {issueId: forIssue, result} = message.payload as {
				issueId: string;
				result: {status: string; message: string; value?: GuiRefCommitEntry[]};
			};

			if (result?.status === 'fail') {
				setCommits(prev =>
					prev && prev.issueId === forIssue
						? {...prev, loading: false, error: result.message}
						: prev,
				);
				return;
			}

			const next = getResultValue<GuiRefCommitEntry[]>(result);

			if (next) {
				setCommits(prev =>
					prev && prev.issueId === forIssue
						? {...prev, loading: false, error: null, commits: next}
						: prev,
				);
			}

			return;
		}

		if (message.type === 'issue:stats:result') {
			// Wrapped with the issueId for the same reason the commits reply is:
			// the Stats tab stays open across a change of ticket.
			const {issueId: forIssue, result} = message.payload as {
				issueId: string;
				result: {status: string; message: string; value?: IssueStats};
			};

			if (result?.status === 'fail') {
				setStats(prev =>
					prev && prev.issueId === forIssue
						? {...prev, loading: false, error: result.message}
						: prev,
				);
				return;
			}

			const next = getResultValue<IssueStats>(result);

			if (next) {
				setStats(prev =>
					prev && prev.issueId === forIssue
						? {...prev, loading: false, error: null, stats: next}
						: prev,
				);
			}

			return;
		}

		if (message.type === 'commit:diff:result') {
			const {sha, result} = message.payload as {
				sha: string;
				result: {status: string; message: string; value?: GuiCommitDiff};
			};

			if (result?.status === 'fail') {
				// Only where the sha is one this panel asked for: the same reply is
				// read by the scrubber's own diff panel.
				setCommitDiffs(prev =>
					prev[sha]
						? {
								...prev,
								[sha]: {loading: false, error: result.message, files: null},
						  }
						: prev,
				);
				return;
			}

			const diff = getResultValue<GuiCommitDiff>(result);

			if (diff) {
				setCommitDiffs(prev =>
					prev[diff.sha]
						? {
								...prev,
								[diff.sha]: {
									loading: false,
									error: null,
									files: diff.files,
								},
						  }
						: prev,
				);
			}
		}
	}, []);

	return {
		detail,
		commits,
		stats,
		loadStats,
		commitDiffs,
		loadCommitDiff,
		updateComments,
		onMessage,
	};
};
