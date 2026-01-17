import {ActionEntry, ModeUnion} from '../model/action-map.model.js';
import {NavigationTree} from '../model/navigation-tree.model.js';

export let navigationState: {
	mode: ModeUnion;
	availableActions: ActionEntry[];
	availableHints: string[];
	currentNode: NavigationTree<NavigationTree> | null;
	breadCrumb: NavigationTree<NavigationTree>[];
} = {
	mode: 'default',
	availableActions: [],
	availableHints: [],
	currentNode: null,
	breadCrumb: [],
};

export const setState = (
	cb: (oldState: typeof navigationState) => typeof navigationState,
) => {
	navigationState = cb(navigationState);
};
