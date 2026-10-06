import {useCallback, useMemo, useState} from 'react';
import {GuiCommitEntry} from './gui-state.model.js';

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

/**
 * What is hidden in effect: only repos with a toggle on screen. The toggles
 * are drawn only while the window holds more than one repo, so a repo hidden
 * in a wider window and alone in this one would otherwise stay hidden with
 * nothing to show it again by.
 */
export const effectiveHidden = (
	keys: readonly string[],
	hidden: ReadonlySet<string>,
): ReadonlySet<string> =>
	keys.length > 1 ? new Set(keys.filter(key => hidden.has(key))) : new Set();

export const withoutHiddenRepos = (
	commits: GuiCommitEntry[],
	hidden: ReadonlySet<string>,
): GuiCommitEntry[] =>
	// The same array back while nothing is hidden: the chart memoizes on it.
	hidden.size === 0
		? commits
		: commits.filter(commit => !hidden.has(keyOf(commit)));

/**
 * The repo filter as the scrubber and the log share it. Not remembered: the
 * repos on offer are whichever the window's commits name.
 */
export const useCommitRepoFilter = (commits: GuiCommitEntry[]) => {
	const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());

	const repos = useMemo(() => commitRepoKeys(commits), [commits]);
	const shownHidden = useMemo(
		() => effectiveHidden(repos, hidden),
		[repos, hidden],
	);
	const plotted = useMemo(
		() => withoutHiddenRepos(commits, shownHidden),
		[commits, shownHidden],
	);

	const toggle = useCallback((repo: string) => {
		setHidden(prev => {
			const next = new Set(prev);
			if (next.has(repo)) next.delete(repo);
			else next.add(repo);
			return next;
		});
	}, []);

	return {repos, hidden: shownHidden, plotted, toggle};
};
