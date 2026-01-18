import {ActionEntry, ModeUnion} from '../model/action-map.model.js';
import {NavigationTree} from '../model/navigation-tree.model.js';

export let navigationState: {
	commandLineInput: string;
	mode: ModeUnion;
	availableActions: ActionEntry[];
	availableHints: string[];
	currentNode: NavigationTree<NavigationTree> | null;
	breadCrumb: NavigationTree<NavigationTree>[];
} = {
	commandLineInput: '',
	mode: 'default',
	availableActions: [],
	availableHints: [],
	currentNode: null,
	breadCrumb: [],
};

export const updateState = (
	cb: (oldState: typeof navigationState) => typeof navigationState,
) => {
	navigationState = cb(navigationState);
};

export const patchState = (patch: Partial<typeof navigationState>) =>
	updateState(oldState => ({
		...oldState,
		...patch,
	}));
