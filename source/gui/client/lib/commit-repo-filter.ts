import {GuiCommitEntry} from './gui-state.model';

// Which repos the Code series plots. The board's own repo is the empty key,
// since its commits carry no repo.

export const OWN_REPO = '';

const keyOf = (commit: GuiCommitEntry): string => commit.repo ?? OWN_REPO;

/** The repos the window's commits come from, the board's own first. */
export const commitRepoKeys = (
	commits: readonly GuiCommitEntry[],
): string[] => {
	const keys = new Set(commits.map(keyOf));

	return [...keys].sort((a, b) =>
		a === OWN_REPO ? -1 : b === OWN_REPO ? 1 : a.localeCompare(b),
	);
};

export const withoutHiddenRepos = (
	commits: GuiCommitEntry[],
	hidden: ReadonlySet<string>,
): GuiCommitEntry[] =>
	// The same array back while nothing is hidden: the chart memoizes on it.
	hidden.size === 0
		? commits
		: commits.filter(commit => !hidden.has(keyOf(commit)));
