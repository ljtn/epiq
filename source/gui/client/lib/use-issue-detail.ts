// What the ticket panel needs beyond board state: bodies, commits and diffs,
// fetched per selected ticket.

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
// Types only, so no Node code crosses the boundary.
import {IssueStats} from '../../../lib/stats/issue-stats.model.js';
import {getResultValue} from './gui-state-helper';
import {
	GuiComment,
	GuiCommitDiff,
	GuiCommitDiffFile,
	GuiIssueHistoryEntry,
	GuiRefCommitEntry,
	GuiSquashedDiff,
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

export type IssueSquashedDiffState = {
	issueId: string;
	// The ticket's newest sha: an unchanged one needs no second look.
	signature: string;
	loading: boolean;
	error: string | null;
	diff: GuiSquashedDiff | null;
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
 * Whether stats or a compacted diff must be asked for again: nothing held, a
 * different ticket or newest commit, or a failure.
 */
export const needsStats = (
	held: {issueId: string; signature: string; error: string | null} | null,
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
	// Asked for when the Stats tab opens, since it costs a git scan.
	loadStats: (issueId: string, signature: string) => void;
	squashed: IssueSquashedDiffState | null;
	// Same bargain as `loadStats`: asked for when the compacted view is opened,
	// not with the rest of the ticket. Most readers never open it.
	loadSquashedDiff: (issueId: string, signature: string) => void;
	commitDiffs: Record<string, CommitDiffState>;
	loadCommitDiff: (sha: string, repo?: string) => void;
	// An optimistic edit to the comments on screen, before the board's own state
	// catches up with the change.
	updateComments: (
		issueId: string,
		update: (comments: GuiComment[]) => GuiComment[],
	) => void;
	// Not exclusive: `commit:diff:result` also serves the scrubber.
	onMessage: (message: any) => void;
};

// A ticket's code as of a scrubbed board's needle, or all of it when live.
const codeRequest = (issueId: string, asOfTime: number | null) =>
	asOfTime === null ? {issueId} : {issueId, asOfTime};

export const useIssueDetail = ({
	issueId,
	asOfTime,
	boardState,
	paused,
	sendRaw,
}: {
	issueId: string | null;
	// The needle of a scrubbed board, or null when live: the Code tab shows
	// the commits made by then.
	asOfTime: number | null;
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
	// Kept for the session and keyed by sha; clearing per ticket would drop
	// replies to requests already in flight.
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

	// Separate from the fetch above: commits come from git, so a board change
	// doesn't rescan. Asked again when another repo's clone moves.
	const [reposEpoch, setReposEpoch] = useState(0);

	// The cut each read was last asked at. A moved needle leaves older answers
	// in flight, and only the latest ask's reply is taken.
	const asOf = useRef(asOfTime);
	asOf.current = asOfTime;
	const askedFor = useRef({
		stats: null as number | null,
		squashed: null as number | null,
	});

	useEffect(() => {
		if (!issueId) {
			setCommits(null);
			return;
		}

		setCommits(prev =>
			prev && prev.issueId === issueId
				? {...prev, loading: true}
				: {issueId, loading: true, error: null, commits: []},
		);
		sendRaw({type: 'issue:commits:get', payload: {issueId}});
	}, [issueId, sendRaw, reposEpoch]);

	// Fetched whole and cut here, at the needle of a scrubbed board, so a
	// dragged needle redraws the list at once instead of reloading it.
	const commitsAtCut = useMemo(
		() =>
			commits && asOfTime !== null
				? {
						...commits,
						commits: commits.commits.filter(commit => commit.time <= asOfTime),
				  }
				: commits,
		[commits, asOfTime],
	);

	const [stats, setStats] = useState<IssueStatsState | null>(null);

	// Cleared on a ticket change rather than refetched: the tab the reader is
	// on decides whether the next one is measured at all.
	useEffect(() => {
		setStats(null);
	}, [issueId]);

	// Only puts the ticket into loading; the effect below asks. An unchanged
	// `signature` asks nothing, and a failure is always retried.
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

		askedFor.current.stats = asOf.current;
		sendRaw({
			type: 'issue:stats:get',
			payload: codeRequest(stats.issueId, asOf.current),
		});
	}, [stats?.issueId, stats?.signature, stats?.loading, sendRaw]);

	const [squashed, setSquashed] = useState<IssueSquashedDiffState | null>(null);

	useEffect(() => {
		setSquashed(null);
	}, [issueId]);

	const loadSquashedDiff = useCallback((id: string, signature: string) => {
		setSquashed(prev =>
			needsStats(prev, id, signature)
				? {issueId: id, signature, loading: true, error: null, diff: null}
				: prev,
		);
	}, []);

	useEffect(() => {
		if (!squashed?.loading) return;

		askedFor.current.squashed = asOf.current;
		sendRaw({
			type: 'issue:squashed-diff:get',
			payload: codeRequest(squashed.issueId, asOf.current),
		});
	}, [squashed?.issueId, squashed?.signature, squashed?.loading, sendRaw]);

	// Which repo each listed commit is in; an unlisted sha lets the server look.
	const repoBySha = useRef(new Map<string, string>());
	repoBySha.current = new Map(
		(commits?.commits ?? []).flatMap(commit =>
			commit.repo ? [[commit.sha, commit.repo] as const] : [],
		),
	);

	// A commit listed elsewhere, as a goal's are, names its repo itself.
	const loadCommitDiff = useCallback(
		(sha: string, repoOfSha?: string) => {
			setCommitDiffs(prev => ({
				...prev,
				[sha]: {loading: true, error: null, files: null},
			}));

			const repo = repoOfSha ?? repoBySha.current.get(sha);
			sendRaw({
				type: 'commit:diff:get',
				payload: repo ? {sha, repo} : {sha},
			});
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
		if (message.type === 'repos:changed') {
			setReposEpoch(epoch => epoch + 1);
			return;
		}

		if (message.type === 'issue') {
			const next = getResultValue<IssueDetail>(message.payload);
			if (next) setDetail(next);
			return;
		}

		if (message.type === 'issue:commits:result') {
			// Wrapped with its issueId, since a failed Result carries none.
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
			const {
				issueId: forIssue,
				asOfTime: forCut,
				result,
			} = message.payload as {
				issueId: string;
				asOfTime: number | null;
				result: {status: string; message: string; value?: IssueStats};
			};
			if (forCut !== askedFor.current.stats) return;

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

		if (message.type === 'issue:squashed-diff:result') {
			// Wrapped with the issueId like its neighbours: the compacted view
			// stays open across a change of ticket.
			const {
				issueId: forIssue,
				asOfTime: forCut,
				result,
			} = message.payload as {
				issueId: string;
				asOfTime: number | null;
				result: {status: string; message: string; value?: GuiSquashedDiff};
			};
			if (forCut !== askedFor.current.squashed) return;

			if (result?.status === 'fail') {
				setSquashed(prev =>
					prev && prev.issueId === forIssue
						? {...prev, loading: false, error: result.message}
						: prev,
				);
				return;
			}

			const next = getResultValue<GuiSquashedDiff>(result);

			if (next) {
				setSquashed(prev =>
					prev && prev.issueId === forIssue
						? {...prev, loading: false, error: null, diff: next}
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
		commits: commitsAtCut,
		stats,
		loadStats,
		squashed,
		loadSquashedDiff,
		commitDiffs,
		loadCommitDiff,
		updateComments,
		onMessage,
	};
};
