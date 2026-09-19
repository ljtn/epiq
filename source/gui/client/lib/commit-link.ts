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
import {GuiCommitEntry} from './gui-state.model';

export const keptCommits = (
	commits: readonly GuiCommitEntry[],
	linkedOnly: boolean,
	// The board is down to the open ticket — the funnel in its panel.
	ticketOnly: boolean,
	// Every ticket the client knows, by ref: the leading-ref rule wants the
	// refs, and the ticket narrowing wants the ids behind them.
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
