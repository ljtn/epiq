// state/state.ts
import {useSyncExternalStore} from 'react';
import {contextActions} from '../actions/board-action-map.js';
import {DefaultActions} from '../actions/default/default-actions.js';
import {inputActions} from '../actions/input/input-actions.js';
import {Hints} from '../hints/hints.js';
import {Mode} from '../model/action-map.model.js';
import type {AppState, BreadCrumb} from '../model/app-state.model.js';
import type {AnyContext, Board, Workspace} from '../model/context.model.js';
import type {NavNode} from '../model/navigation-node.model.js';
import {deepFreeze} from '../utils/immutable.js';
import {findNodeInTree} from '../utils/nav-tree.js';

type DerivedKeys =
	| 'availableActions'
	| 'availableHints'
	| 'breadCrumb'
	| 'currentNode';
export type BaseState = Omit<AppState, DerivedKeys>;

// -----------------------------
// Internal store
// -----------------------------
let _appState: AppState;

const listeners = new Set<() => void>();
const emit = () => {
	for (const l of listeners) l();
};
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

// -----------------------------
// Derivation
// -----------------------------
function derive(state: BaseState): AppState {
	const {currentNodeId, mode, rootNode} = state;

	if (!currentNodeId) {
		throw new Error('derive(): currentNodeId is missing');
	}
	if (!rootNode) {
		throw new Error('derive(): rootNode is missing');
	}

	const found = findNodeInTree(currentNodeId, rootNode, []);
	if (!found?.node || !found?.breadCrumb) {
		throw new Error(`derive(): unable to find node ${currentNodeId} in tree`);
	}

	const currentNode = found.node;
	const breadCrumb: BreadCrumb = found.breadCrumb;

	const {context} = currentNode;
	const availableHints = Hints[context + mode] ?? Hints[context] ?? [];

	// Consider not freezing if performance issues
	const availableActions = deepFreeze([
		...DefaultActions,
		...(contextActions[context] ?? []),
		...inputActions,
	]);

	// Consider not freezing if performance issues
	return deepFreeze({
		...state,
		currentNode,
		breadCrumb,
		availableHints,
		availableActions,
	});
}

// -----------------------------
// Public API
// -----------------------------
export const getState = () => {
	if (!_appState) {
		logger.error('State not initialized. Call initWorkspaceState() first.');
	}
	return _appState;
};

export function initWorkspaceState(workspace: Workspace) {
	const firstBoard = workspace.children?.[0] as Board | undefined;

	const base: BaseState = {
		mode: Mode.DEFAULT,
		rootNode: workspace,
		currentNodeId: firstBoard?.id ?? workspace.id, // fallback: workspace
		selectedIndex: 0,
	};

	_appState = derive(base);
	emit();
}

/**
 * Derived fields are always recomputed.
 * Callers can *read* full AppState via getState(), but can’t *write* derived keys.
 */
export function updateState(cb: (old: AppState) => BaseState) {
	const prev = getState();
	const nextBase = cb(prev);
	_appState = derive(nextBase);
	emit();
}

export const patchState = (patch: Partial<BaseState>) =>
	updateState(old => ({...old, ...patch}));

export const isChildSelected = (
	parent: NavNode<AnyContext>,
	i: number,
	state: AppState,
): boolean => parent.id === state.currentNode.id && state.selectedIndex === i;

/** Ink/React hook: components re-render on state changes. */
export const useAppState = () =>
	useSyncExternalStore(subscribe, getState, getState);
