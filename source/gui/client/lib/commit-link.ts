// Which commits the Code series keeps. Repository-wide by default: every
// commit is plotted whether or not it names a ticket. Narrowed to linked
// commits, it keeps the ones whose subject leads with the ref of a ticket the
// board knows — and, while the board is down to some tickets, only the ones
// linked to those, the same rule the board events above the columns follow.

import {commitTicketRef} from '../../../lib/utils/commit-ref.js';
import {GuiCommitEntry} from './gui-state.model';

export const keptCommits = (
	commits: readonly GuiCommitEntry[],
	linkedOnly: boolean,
	// Every ticket the client knows, by ref: the leading-ref rule wants the
	// refs, and the ticket narrowing wants the ids behind them.
	issueIdByRef: ReadonlyMap<string, string>,
	keptIssues: ReadonlySet<string> | null,
): readonly GuiCommitEntry[] => {
	// The same array back, not a copy: the chart memoizes on it.
	if (!linkedOnly) return commits;

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
