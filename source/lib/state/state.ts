import {useSyncExternalStore} from 'react';
import {contextActions} from '../actions/board-action-map.js';
import {DefaultActions} from '../actions/default/default-actions.js';
import {inputActions} from '../actions/input/input-actions.js';
import {Hints} from '../hints/hints.js';
import {ActionEntry, ModeUnion} from '../model/action-map.model.js';
import {AnyContext, Board, Workspace} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {DeepReadonly} from '../model/readonly.model.js';
import {deepFreeze} from '../utils/immutable.js';

export type BreadCrumb =
	| [NavNode<'WORKSPACE'>]
	| [NavNode<'WORKSPACE'>, NavNode<'BOARD'>]
	| [NavNode<'WORKSPACE'>, NavNode<'BOARD'>, NavNode<'SWIMLANE'>]
	| [
			NavNode<'WORKSPACE'>,
			NavNode<'BOARD'>,
			NavNode<'SWIMLANE'>,
			NavNode<'TICKET'>,
	  ]
	| [
			NavNode<'WORKSPACE'>,
			NavNode<'BOARD'>,
			NavNode<'SWIMLANE'>,
			NavNode<'TICKET'>,
			NavNode<'FIELD'>,
	  ];

export type AppState = DeepReadonly<{
	selectedIndex: number;
	mode: ModeUnion;
	availableActions: ActionEntry[];
	availableHints: string[];
	currentNode: NavNode<AnyContext>;
	breadCrumb: BreadCrumb;
	rootNode: Workspace;
}>;

let _appState: AppState;

const listeners = new Set<() => void>();

const emit = () => {
	for (const l of listeners) l();
};

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

export const getState = () => _appState;

/**
 * Ink/React hook: components that call this will re-render on state changes.
 */
export const useAppState = () =>
	useSyncExternalStore(subscribe, getState, getState);

const derived = (state: AppState): AppState => {
	const {currentNode, mode} = state;
	const {context} = currentNode;

	const availableHints = Hints[context + mode] ?? Hints[context];

	const availableActions = [
		...DefaultActions,
		...contextActions[context],
		...inputActions,
	];

	return deepFreeze({
		...state,
		availableHints,
		availableActions,
	});
};

export const initWorkspaceState = (workspace: Workspace) => {
	const selectedBoard = workspace.children.at(0) as Board;

	_appState = derived({
		rootNode: workspace,
		breadCrumb: [workspace, selectedBoard],
		selectedIndex: 0,
		mode: 'default',
		currentNode: selectedBoard,
		availableActions: [],
		availableHints: [],
	});

	// With useSyncExternalStore, React/Ink will re-render from subscriptions.
	// If you still bootstrap manually, emit ensures any mounted UI updates.
	emit();
};

export const updateState = (
	cb: (oldState: AppState) => AppState,
	_opts: {render?: boolean} = {render: true},
) => {
	const next = cb(_appState);
	_appState = derived(next);
	emit();
};

export const patchState = (
	patch: Partial<AppState>,
	opts: {render?: boolean} = {render: true},
) => updateState(old => ({...old, ...patch}), opts);

export const updateCurrentNode = (
	mapper: (node: NavNode<AnyContext>) => NavNode<AnyContext>,
	opts: {render?: boolean} = {render: true},
) =>
	updateState(old => {
		const current = old.currentNode;
		const next = mapper(current);

		// keep breadcrumb consistent: replace last entry
		const nextBreadCrumb = [
			...old.breadCrumb.slice(0, -1),
			next,
		] as unknown as typeof old.breadCrumb;

		return {
			...old,
			currentNode: next,
			breadCrumb: nextBreadCrumb,
		};
	}, opts);

export const appendChildToCurrentNode = <C extends NavNode<any>>(
	child: C,
	opts: {selectNewChild?: boolean; render?: boolean} = {
		selectNewChild: true,
		render: true,
	},
) =>
	updateCurrentNode(
		node => {
			const nextChildren = [...node.children, child] as typeof node.children;

			return {
				...node,
				children: nextChildren,
			};
		},
		{render: opts.render},
	);

export const appendChildToCurrentNodeAndSelect = <C extends NavNode<any>>(
	child: C,
	opts: {render?: boolean} = {render: true},
) =>
	updateState(old => {
		const node = old.currentNode;
		const nextChildren = [...node.children, child] as typeof node.children;
		const nextNode = {...node, children: nextChildren};

		const nextBreadCrumb = [
			...old.breadCrumb.slice(0, -1),
			nextNode,
		] as unknown as typeof old.breadCrumb;

		return {
			...old,
			currentNode: nextNode,
			breadCrumb: nextBreadCrumb,
			selectedIndex: nextChildren.length - 1,
		};
	}, opts);

export const isChildSelected = (
	container: NavNode<AnyContext>,
	i: number,
	state: {currentNode: NavNode<AnyContext>; selectedIndex: number},
): boolean =>
	container.id === state.currentNode.id && state.selectedIndex === i;
