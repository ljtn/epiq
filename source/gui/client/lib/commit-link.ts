// Which commits the Code series keeps. Repository-wide by default: every
// commit is plotted whether or not it names a ticket. Two things narrow that,
// and either one is enough: the series select set to linked commits, which
// keeps the ones whose subject leads with the ref of a ticket the board knows;
// and the board being down to the one ticket on screen, whose commits are the
// ones linked to it whatever the select says — the same rule its events follow,
// so the narrowing takes the picture down to one ticket rather than leaving the
// repository's commits standing over it.
//
// The board's other narrowings do not do this. A text filter leaves several
// tickets on screen and says nothing about commits, so under it the select
// still decides; what it narrows, where the select asks for linked commits, is
// which tickets a link may name.

import {commitTicketRef} from '../../../lib/utils/commit-ref.js';
import {GuiBoard, GuiCommitEntry} from './gui-state.model';

// The tickets a link may name, by ref, for one board or for every board. Which
// of the two a caller wants is the same question `onThisBoard` answers for
// events: the log narrows to the board on screen, because a commit linked to a
// ticket the board does not carry leads nowhere it can go, and the chart keeps
// the repository, because that is what it plots. A null board is every board,
// as it is there.
//
// A closed ticket counts for both the global Closed board it sits on and the
// board it was closed from. Closing is what most tickets end up doing, so
// reading its board as `Closed` alone would empty a board's own log of nearly
// every commit ever linked to it.
export const issueIdByRefFor = (
	boards: readonly GuiBoard[],
	boardId: string | null,
): ReadonlyMap<string, string> =>
	new Map(
		boards.flatMap(board =>
			board.swimlanes.flatMap(swimlane =>
				swimlane.issues
					.filter(
						issue =>
							boardId === null ||
							board.id === boardId ||
							issue.closedFromBoardId === boardId,
					)
					.map(issue => [issue.ref, issue.id] as const),
			),
		),
	);

/**
 * Which of the two maps the commit rule reads.
 *
 * The board's own, except where the reader has deliberately reached past it:
 * the funnel down to one open ticket, which a ref link can open from another
 * board and whose own commits are the whole of what the funnel is for; and the
 * chart plotting every board, which is then what it is plotting.
 *
 * One place rather than one per series. The log and the chart each asked this
 * for themselves, in opposite phrasings and with different terms, which is how
 * a third case comes to be added to one of them.
 */
export const linkableIssues = ({
	everyBoard,
	thisBoard,
	ticketFocus,
	everyBoardPlotted = false,
}: {
	everyBoard: ReadonlyMap<string, string>;
	thisBoard: ReadonlyMap<string, string>;
	ticketFocus: boolean;
	everyBoardPlotted?: boolean;
}): ReadonlyMap<string, string> =>
	ticketFocus || everyBoardPlotted ? everyBoard : thisBoard;

export const keptCommits = (
	commits: readonly GuiCommitEntry[],
	linkedOnly: boolean,
	// The board is down to the open ticket — the funnel in its panel.
	ticketOnly: boolean,
	// The tickets a link may name, by ref: the leading-ref rule wants the refs,
	// and the ticket narrowing wants the ids behind them. Which tickets those
	// are is the caller's to say — the log hands its board's, the chart the
	// repository's.
	issueIdByRef: ReadonlyMap<string, string>,
	keptIssues: ReadonlySet<string> | null,
): readonly GuiCommitEntry[] => {
	// The same array back, not a copy: the chart memoizes on it.
	if (!linkedOnly && !ticketOnly) return commits;

	const refs = new Set(issueIdByRef.keys());

	return commits.filter(commit => {
		const ref = commitTicketRef(commit.subject, refs);
		if (ref === null) return false;

		const issueId = issueIdByRef.get(ref);

		return (
			issueId !== undefined && (keptIssues === null || keptIssues.has(issueId))
		);
	});
};
