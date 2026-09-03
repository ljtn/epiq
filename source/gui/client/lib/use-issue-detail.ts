// Everything the ticket panel needs that the board's own state does not carry:
// the description and comment bodies, the ticket's commits, and the diff of any
// commit opened in its Code tab.
//
// Three fetches, three replies and three pieces of state that were spread
// across the component rendering the panel. They belong together — each is
// asked for when the selected ticket changes, and each is thrown away when it
// changes again.

import {useCallback, useEffect, useState} from 'react';
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

export type CommitDiffState = {
	loading: boolean;
	error: string | null;
	files: GuiCommitDiffFile[] | null;
};

export type IssueDetailPanel = {
	detail: IssueDetail | null;
	commits: IssueCommits | null;
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
		commitDiffs,
		loadCommitDiff,
		updateComments,
		onMessage,
	};
};
