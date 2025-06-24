import {ActionEntry, ModeOptions} from '../model/action-map.model.js';
import {NavigateCtx} from '../model/navigation-ctx.model.js';
import {NavigationTree} from '../model/navigation-tree.model.js';

export let navigationState: {
	mode: ModeOptions;
	availableActions: ActionEntry<[NavigateCtx]>[];
	viewHelp: boolean;
	currentNode: NavigationTree<NavigationTree> | null;
	breadCrumb: NavigationTree<NavigationTree>[];
} = {
	mode: 'default',
	availableActions: [],
	viewHelp: false,
	currentNode: null,
	breadCrumb: [],
};

export const setState = (
	cb: (oldState: typeof navigationState) => typeof navigationState,
) => {
	navigationState = cb(navigationState);
};
