import {useSyncExternalStore} from 'react';
import {contextActions} from '../actions/action-map.js';
import {DefaultActions} from '../actions/default/default-actions.js';
import {inputActions} from '../actions/input/input-actions.js';
import {Hints} from '../hints/hints.js';
import {readProjectFile} from '../project-setup/project-setup.js';
import {Mode} from '../model/action-map.model.js';
import type {AppState, Filter} from '../model/app-state.model.js';
import {
	isTicketNode,
	type AnyContext,
	type Workspace,
} from '../model/context.model.js';
import type {NavNode} from '../model/navigation-node.model.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {resolveClosestEpiqProjectRoot} from '../storage/paths.js';
import {ticketMatchesFilter} from '../utils/filter.js';
import {buildBreadCrumb} from '../utils/nav-tree.js';
import {buildActionIndex} from './action-helper.js';

type DerivedKeys =
	| 'availableActions'
	| 'actionIndex'
	| 'availableHints'
	| 'breadCrumb'
	| 'contextNode'
	| 'selectedNode';
export type BaseState = Omit<AppState, DerivedKeys>;

// -----------------------------
// Internal store
// -----------------------------
let _appState: AppState | undefined;
let _initialWorkspace: Workspace | undefined;

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
function derive(state: BaseState): Result<AppState> {
	const {contextNodeId, mode, rootNodeId, nodes, filters} = state;

	if (!contextNodeId) {
		return failed('derive(): contextNodeId is missing');
	}
	if (!rootNodeId) {
		return failed('derive(): rootNode is missing');
	}

	const rootNode = nodes[rootNodeId];
	if (!rootNode) {
		return failed(`derive(): unable to find root node`);
	}

	const contextNode = nodes[contextNodeId];
	if (!contextNode) {
		return failed('Unable to derive state, contextNode not found');
	}

	const breadCrumbResult = buildBreadCrumb(contextNodeId, nodes, rootNodeId);
	if (isFail(breadCrumbResult)) {
		logger.error(breadCrumbResult.message);
		return breadCrumbResult;
	}
	const breadCrumb = breadCrumbResult.value;

	const {context} = contextNode;
	const availableHints = Hints[context + mode] ?? Hints[context] ?? [];

	const availableActions = [
		...DefaultActions,
		...(contextActions[context] ?? []),
		...inputActions,
	];
	const actionIndex = buildActionIndex(availableActions);

	const renderedChildrenIndex = buildChildIndex(nodes, filters);
	const selectedNode =
		renderedChildrenIndex[contextNodeId]?.[state.selectedIndex] ?? null;

	return succeeded('Derived successfully', {
		...state,
		contextNode,
		breadCrumb,
		availableHints,
		availableActions,
		actionIndex,
		selectedNode,
		renderedChildrenIndex,
	});
}

// -----------------------------
// Public API
// -----------------------------
export const getState = () => {
	if (!_appState) {
		throw new Error('State not initialized. Call initWorkspaceState() first.');
	}

	return _appState;
};
export const getSafeState = () => {
	if (!_appState)
		return failed('State not initialized. Call initWorkspaceState() first.');

	return succeeded('Retrieved state', _appState);
};

export function initWorkspaceState(workspace: Workspace) {
	_initialWorkspace = workspace;
	const repoRootResult = resolveClosestEpiqProjectRoot(process.cwd());

	let hasProjectDefinition = false;

	if (!isFail(repoRootResult)) {
		const projectResult = readProjectFile(repoRootResult.value);
		if (isFail(projectResult)) return failed(projectResult.message);

		hasProjectDefinition = true;
	}

	const base: BaseState = {
		readOnly: false,
		filters: [],
		tags: {},
		contributors: {},
		mode: Mode.DEFAULT,
		nodes: {[workspace.id]: workspace},
		rootNodeId: workspace.id,
		contextNodeId: workspace.id,
		renderedChildrenIndex: {},
		selectedIndex: -1,
		syncStatus: {
			status: 'synced',
			msg: '',
		},
		eventLog: [],
		unappliedEvents: [],
		replay: null,
		timeMode: 'live',
		hasProjectDefinition,
		hasInitializingEvents: false,
		comments: {},
	};

	const deriveResult = derive(base);
	if (isFail(deriveResult)) return deriveResult;

	_appState = deriveResult.value;
	emit();

	return succeeded('State initialized', null);
}

/**
 * Derived fields are always recomputed.
 * Callers can *read* full AppState via getState(), but can’t *write* derived keys.
 */
export function updateState(cb: (old: AppState) => BaseState): Result<string> {
	const prev = getState();
	const nextBase = cb(prev);
	const deriveResult = derive(nextBase);
	if (isFail(deriveResult)) {
		return failed(deriveResult.message ?? 'Unable to update state');
	}
	_appState = deriveResult.value;
	emit();
	return succeeded('State updated', null);
}

export const patchState = (patch: Partial<BaseState>) =>
	updateState(old => ({...old, ...patch}));

export const isChildSelected = (
	parent: NavNode<AnyContext>,
	i: number,
	state: AppState,
): boolean => parent.id === state.contextNode.id && state.selectedIndex === i;

/** Ink/React hook: components re-render on state changes. */
export const useAppState = () =>
	useSyncExternalStore(subscribe, getState, getState);

const buildChildIndex = (
	nodes: Record<string, NavNode<AnyContext>>,
	filters: Filter[],
) => {
	const index: Record<string, NavNode<AnyContext>[]> = {};

	for (const node of Object.values(nodes)) {
		if (
			isTicketNode(node) &&
			filters.length > 0 &&
			!filters.every(filter => ticketMatchesFilter(node, filter))
		)
			continue;

		if (!node.parentNodeId || node.isDeleted) continue;

		if (!node.parentNodeId || !index[node.parentNodeId]) {
			index[node.parentNodeId] = [];
		}

		index[node.parentNodeId]!.push(node);
	}

	for (const parentId of Object.keys(index)) {
		index[parentId]!.sort((a, b) => {
			const left = nodes[a.id];
			const right = nodes[b.id];
			if (!left || !right) return 0;
			return left.rank.localeCompare(right.rank);
		});
	}

	return index;
};

export const getRenderedChildren = (id: string): NavNode<AnyContext>[] => {
	return getState()?.renderedChildrenIndex[id] ?? [];
};

export const resetState = (): Result<string> => {
	if (!_initialWorkspace) {
		return failed('Cannot reset state: no initial workspace found');
	}

	return initWorkspaceState(_initialWorkspace);
};

export const isStateInitialized = () => _appState !== undefined;
