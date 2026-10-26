// Which commits the Code series keeps: every commit, unless the select asks
// for linked commits or the board is down to one ticket.

import {commitTicketRefs} from '../../../lib/utils/commit-ref.js';
import {GuiBoard, GuiCommitEntry} from './gui-state.model';

// The tickets a link may name, by ref, for one board or every board (null).
// A ticket counts for every board it has lived on.
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
							// Answers even if its own lane is missing from the payload.
							board.id === boardId ||
							issue.boardIds.includes(boardId),
					)
					.map(issue => [issue.ref, issue.id] as const),
			),
		),
	);

/**
 * Which map the commit rule reads: the board's own, or every board for a
 * funnel to one ticket or a chart plotting every board.
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
	// The tickets a link may name, by ref.
	issueIdByRef: ReadonlyMap<string, string>,
	keptIssues: ReadonlySet<string> | null,
): readonly GuiCommitEntry[] => {
	// The same array back, not a copy: the chart memoizes on it.
	if (!linkedOnly && !ticketOnly) return commits;

	const refs = new Set(issueIdByRef.keys());

	return commits.filter(commit =>
		commitTicketRefs(commit, refs).some(ref => {
			const issueId = issueIdByRef.get(ref);

			return (
				issueId !== undefined &&
				(keptIssues === null || keptIssues.has(issueId))
			);
		}),
	);
};
