import {createContext, useCallback, useContext} from 'react';
import {repoLabelOf} from './repo-label';

// What each registered repo is called, by id, as the repo list last gave it.
// A repo can be labelled apart from its URL, and the id carries only the
// URL's basename — so the list is where a chip or a toggle reads the name.
export const RepoLabelsContext = createContext<ReadonlyMap<string, string>>(
	new Map(),
);

/** A repo's name on the board: as labelled, else as its id carries it. */
export const useRepoLabel = () => {
	const labels = useContext(RepoLabelsContext);

	return useCallback(
		(repoId: string) => labels.get(repoId) ?? repoLabelOf(repoId),
		[labels],
	);
};
