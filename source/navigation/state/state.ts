import {Hints} from '../../board/hints/hints.js';
import {Board} from '../../board/model/board.model.js';
import {triggerRender} from '../../cli.js';
import {ActionEntry, ModeUnion} from '../model/action-map.model.js';
import {NavigationTree} from '../model/navigation-tree.model.js';

export let appState: {
	mode: ModeUnion;
	availableActions: ActionEntry[];
	availableHints: readonly string[];
	currentNode: NavigationTree<NavigationTree> | null;
	breadCrumb: NavigationTree<NavigationTree>[];
	board: Board | undefined;
} = {
	mode: 'default',
	availableActions: [],
	availableHints: [],
	currentNode: null,
	breadCrumb: [],
	board: undefined,
};

export const initAppState = (board: Board) => {
	appState = {...appState, board};
};

export const updateState = (
	cb: (oldState: typeof appState) => typeof appState,
) => {
	appState = cb(appState);
};

export const patchState = (patch: Partial<typeof appState>) =>
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
