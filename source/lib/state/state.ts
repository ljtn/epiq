// state/state.ts
import {useSyncExternalStore} from 'react';
import {contextActions} from '../actions/board-action-map.js';
import {DefaultActions} from '../actions/default/default-actions.js';
import {inputActions} from '../actions/input/input-actions.js';
import {Hints} from '../hints/hints.js';
import {Mode} from '../model/action-map.model.js';
import type {AppState, BreadCrumb} from '../model/app-state.model.js';
import type {AnyContext} from '../model/context.model.js';
import type {NavNode} from '../model/navigation-node.model.js';
import {findNodeInTree} from '../utils/nav-tree.js';
import {buildActionIndex} from './action-helper.js';

type DerivedKeys =
	| 'availableActions'
	| 'actionIndex'
	| 'availableHints'
	| 'breadCrumb'
	| 'currentNode';
export type BaseState = Omit<AppState, DerivedKeys>;

// -----------------------------
// Internal store
// -----------------------------∏
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
	const {currentNodeId, mode, rootNodeId, nodes} = state;

	if (!currentNodeId) {
		throw new Error('derive(): currentNodeId is missing');
	}
	if (!rootNodeId) {
		throw new Error('derive(): rootNode is missing');
	}

	const rootNode = nodes[rootNodeId];
	if (!rootNode) {
		throw new Error(`derive(): unable to find root node`);
	}
	const found = findNodeInTree({id: currentNodeId}, rootNode, [], nodes);
	if (!found?.node || !found?.breadCrumb) {
		throw new Error(`derive(): unable to find node ${currentNodeId} in tree`);
	}

	const currentNode = found.node;
	const breadCrumb: BreadCrumb = found.breadCrumb;

	const {context} = currentNode;
	const availableHints = Hints[context + mode] ?? Hints[context] ?? [];

	// Consider not freezing if performance issues
	const availableActions = [
		...DefaultActions,
		...(contextActions[context] ?? []),
		...inputActions,
	];
	const actionIndex = buildActionIndex(availableActions);

	// Consider not freezing if performance issues
	return {
		...state,
		currentNode,
		breadCrumb,
		availableHints,
		availableActions,
		actionIndex,
	};
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

export function initWorkspaceState(
	nodes: Record<string, NavNode<AnyContext>>,
	workspaceId: string,
) {
	logger.info(1);
	const workspace = nodes[workspaceId];
	const firstBoardId = workspace?.children?.[0];
	if (!firstBoardId) {
		logger.error('Unable to find first id');
		return;
	}
	logger.info(2);
	const firstBoard = nodes[firstBoardId];
	if (!firstBoard) {
		logger.error('Unable to find first board');
		return;
	}
	logger.info(3);
	const firstTicketId = firstBoard?.children[0];
	if (!firstTicketId) return;
	const firstTicket = nodes[firstTicketId];
	if (!firstTicket) {
		logger.error('Unable to find first ticket');
		return;
	}
	logger.info(4);
	const currentNode = firstTicket ?? firstBoard ?? workspace;

	logger.info(5);
	const base: BaseState = {
		nodes,
		mode: Mode.DEFAULT,
		rootNodeId: firstBoardId,
		currentNodeId: currentNode.id,
		selectedIndex: currentNode.children.length ? 0 : -1,
		viewMode: 'dense',
	};

	logger.info(6);
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
