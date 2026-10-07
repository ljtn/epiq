import {useCallback, useEffect, useMemo, useState} from 'react';
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

/** Whether the repo toggles are drawn: only while there is a choice. */
export const showsRepoToggles = (keys: readonly string[]): boolean =>
	keys.length > 1;

/**
 * What is hidden in effect: only repos with a toggle on screen, so a repo
 * hidden in a wider window and alone in this one is not hidden with nothing
 * to show it again by.
 */
export const effectiveHidden = (
	keys: readonly string[],
	hidden: ReadonlySet<string>,
): ReadonlySet<string> =>
	showsRepoToggles(keys)
		? new Set(keys.filter(key => hidden.has(key)))
		: new Set();

export const withoutHiddenRepos = (
	commits: GuiCommitEntry[],
	hidden: ReadonlySet<string>,
): GuiCommitEntry[] =>
	// The same array back while nothing is hidden: the chart memoizes on it.
	hidden.size === 0
		? commits
		: commits.filter(commit => !hidden.has(keyOf(commit)));

/** Hidden repos still registered; the board's own is always registered. */
export const prunedHidden = (
	hidden: ReadonlySet<string>,
	registered: readonly string[],
): ReadonlySet<string> => {
	const kept = [...hidden].filter(
		key => key === OWN_REPO || registered.includes(key),
	);
	return kept.length === hidden.size ? hidden : new Set(kept);
};

/**
 * The repo filter as the scrubber and the log share it. Not remembered: the
 * repos on offer are whichever the window's commits name. `registered` is the
 * repo list when it is known: a repo removed is unhidden, so it is not hidden
 * again if it comes back.
 */
export const useCommitRepoFilter = (
	commits: GuiCommitEntry[],
	registered: readonly string[] | null = null,
) => {
	const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());

	useEffect(() => {
		if (registered) setHidden(prev => prunedHidden(prev, registered));
	}, [registered]);

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
