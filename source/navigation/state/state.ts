import {Hints} from '../../board/hints/hints.js';
import {triggerRender} from '../../cli.js';
import {ActionEntry, ModeUnion} from '../model/action-map.model.js';
import {NavigationTree} from '../model/navigation-tree.model.js';

export let navigationState: {
	mode: ModeUnion;
	availableActions: ActionEntry[];
	availableHints: readonly string[];
	currentNode: NavigationTree<NavigationTree> | null;
	breadCrumb: NavigationTree<NavigationTree>[];
} = {
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

// Utilities for updating specific parts of the state
export const flashHint = async (hints: string[]): Promise<void> => {
	await new Promise<void>(resolve => {
		setTimeout(() => {
			updateState(state => {
				const {currentNode, mode} = state;
				const contextualHints = (currentNode &&
					Hints[currentNode.actionContext + mode]) ??
					(currentNode && Hints[currentNode.actionContext]) ?? [''];
				return {
					...state,
					availableHints: contextualHints,
				};
			});
			triggerRender();
			resolve();
		}, 3_000);
		patchState({
			availableHints: hints,
		});
		triggerRender();
	});
};
