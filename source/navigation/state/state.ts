import {Hints} from '../../board/hints/hints.js';
import {Board} from '../../board/model/context.model.js';
import {renderBoard} from '../../cli.js';
import {contextActions} from '../actions/board-action-map.js';
import {DefaultActions} from '../actions/default/default-actions.js';
import {inputActions} from '../actions/input/input-actions.js';
import {ActionEntry, ModeUnion} from '../model/action-map.model.js';
import {NavigationTree} from '../model/navigation-tree.model.js';

export type AppState = {
	readonly selectedIndex: number;
	readonly mode: ModeUnion;
	readonly availableActions: ActionEntry[];
	readonly availableHints: readonly string[];
	readonly currentNode: NavigationTree<NavigationTree>;
	readonly breadCrumb: NavigationTree<NavigationTree>[];
	readonly rootNode: Board;
};

export let appState: AppState;

const derived = (state: typeof appState): typeof appState => {
	const {currentNode, mode} = state;

	const availableHints =
		Hints[currentNode.actionContext + mode] ?? Hints[currentNode.actionContext];

	const actionContext = currentNode?.actionContext;
	const availableActions = [
		...DefaultActions,
		...contextActions[actionContext],
		...inputActions,
	];

	return {
		...state,
		availableHints,
		availableActions,
	};
};

export const initAppState = (board: Board) => {
	appState = derived({
		...appState,
		rootNode: board,
		breadCrumb: [board],
		selectedIndex: 0,
		mode: 'default',
		currentNode: board,
	});
	renderBoard();
};

export const updateState = (
	cb: (oldState: typeof appState) => typeof appState,
	opts: {render?: boolean} = {render: true},
) => {
	appState = derived(cb(appState));
	if (opts.render) renderBoard();
};

export const patchState = (
	patch: Partial<typeof appState>,
	opts: {render?: boolean} = {render: true},
) => updateState(old => ({...old, ...patch}), opts);
