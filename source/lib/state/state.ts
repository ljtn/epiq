import {useSyncExternalStore} from 'react';
import {contextActions} from '../actions/board-action-map.js';
import {DefaultActions} from '../actions/default/default-actions.js';
import {inputActions} from '../actions/input/input-actions.js';
import {Hints} from '../hints/hints.js';
import {Mode} from '../model/action-map.model.js';
import {AppState, BreadCrumb} from '../model/app-state.model.js';
import {AnyContext, Board, Workspace} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {deepFreeze} from '../utils/immutable.js';
import {findNodeInTree} from '../utils/nav-tree.js';

let _appState: AppState;

const listeners = new Set<() => void>();
const emit = () => {
	for (const l of listeners) l();
};
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

const derived = (
	state:
		| AppState
		| Omit<
				AppState,
				'availableActions' | 'availableHints' | 'breadCrumb' | 'currentNode'
		  >,
): AppState => {
	const {currentNodeId, mode, rootNode} = state;
	if (currentNodeId === undefined)
		return logger.error('Unable to derive state from undefined currentNodeId');
	if (rootNode === undefined)
		return logger.error('Unable to derive state from undefined root node');

	let breadCrumb: BreadCrumb;
	const result = findNodeInTree(currentNodeId, rootNode, []);

	if (!result?.node || !result?.breadCrumb)
		return logger.error('Unable to find node in tree');

	breadCrumb = result.breadCrumb;
	const currentNode = result.node;
	const {context} = currentNode;

	const availableHints = Hints[context + mode] ?? Hints[context];
	const availableActions = [
		...DefaultActions,
		...contextActions[context],
		...inputActions,
	];

	return deepFreeze({
		...state,
		currentNode,
		breadCrumb,
		availableHints,
		availableActions,
	});
};

export const getState = () => _appState;

export const initWorkspaceState = (workspace: Workspace) => {
	const selectedBoard = workspace.children.at(0) as Board;

	_appState = derived({
		mode: Mode.DEFAULT,
		rootNode: workspace,
		currentNodeId: selectedBoard.id,
		selectedIndex: 0,
	});

	emit();
};

export const updateState = (cb: (oldState: AppState) => AppState) => {
	const next = cb(_appState);
	_appState = derived(next);
	emit();
};

export const patchState = (patch: Partial<AppState>) =>
	updateState(old => ({...old, ...patch}));

// export const appendChildToCurrentNode = <C extends NavNode<any>>(child: C) =>
// 	updateCurrentNode(node => ({
// 		...node,
// 		children: [...node.children, child] as typeof node.children,
// 	}));

export const isChildSelected = (
	parent: NavNode<AnyContext>,
	i: number,
	state: AppState,
): boolean => parent.id === state.currentNode.id && state.selectedIndex === i;

/** Ink/React hook: components re-render on state changes. */
export const useAppState = () =>
	useSyncExternalStore(subscribe, getState, getState);
