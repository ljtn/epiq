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

/** Ink/React hook: components re-render on state changes. */
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

/** Replace a direct child by id (structural sharing). */
const replaceChildById = <P extends NavNode<any>>(
	parent: P,
	childId: string,
	nextChild: NavNode<AnyContext>,
): P => {
	const idx = parent.children.findIndex(c => c.id === childId);
	if (idx < 0) return parent;

	const nextChildren = parent.children.map((c, i) =>
		i === idx ? (nextChild as any) : c,
	) as typeof parent.children;

	// no-op
	if (nextChildren.every((c, i) => c === parent.children[i])) return parent;

	return {...parent, children: nextChildren} as P;
};

/**
 * Given the existing breadcrumb and a new leaf node, rebuild:
 * - rootNode
 * - breadCrumb (with updated instances)
 * - currentNode (tree instance)
 */
const rebuildFromBreadCrumb = (
	breadCrumb: BreadCrumb,
	nextLeaf: NavNode<AnyContext>,
): {
	rootNode: Workspace;
	breadCrumb: BreadCrumb;
	currentNode: NavNode<AnyContext>;
} => {
	const nextPath: any[] = Array(breadCrumb.length);
	nextPath[nextPath.length - 1] = nextLeaf;

	for (let i = breadCrumb.length - 2; i >= 0; i--) {
		const parent = breadCrumb[i] as unknown as NavNode<AnyContext>;
		const child = nextPath[i + 1] as NavNode<AnyContext>;
		nextPath[i] = replaceChildById(parent, child.id, child);
	}

	return {
		rootNode: nextPath[0] as Workspace,
		breadCrumb: nextPath as BreadCrumb,
		currentNode: nextPath[nextPath.length - 1] as NavNode<AnyContext>,
	};
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

/**
 * Update current node immutably AND keep the whole tree consistent.
 * This fixes "adding a board doesn't show up" because rootNode changes too.
 */
export const updateCurrentNode = (
	mapper: (node: NavNode<AnyContext>) => NavNode<AnyContext>,
	opts: {render?: boolean} = {render: true},
) =>
	updateState(old => {
		const nextLeaf = mapper(old.currentNode);
		const rebuilt = rebuildFromBreadCrumb(
			old.breadCrumb as BreadCrumb,
			nextLeaf,
		);

		return {
			...old,
			...rebuilt,
		};
	}, opts);

export const appendChildToCurrentNode = <C extends NavNode<any>>(
	child: C,
	opts: {render?: boolean} = {render: true},
) =>
	updateCurrentNode(
		node => ({
			...node,
			children: [...node.children, child] as typeof node.children,
		}),
		opts,
	);

export const appendChildToCurrentNodeAndSelect = <C extends NavNode<any>>(
	child: C,
	opts: {render?: boolean} = {render: true},
) =>
	updateState(old => {
		const nextLeaf = {
			...old.currentNode,
			children: [
				...old.currentNode.children,
				child,
			] as typeof old.currentNode.children,
		};

		const rebuilt = rebuildFromBreadCrumb(
			old.breadCrumb as BreadCrumb,
			nextLeaf,
		);

		return {
			...old,
			...rebuilt,
			selectedIndex: nextLeaf.children.length - 1,
		};
	}, opts);

export const isChildSelected = (
	container: NavNode<AnyContext>,
	i: number,
	state: {currentNode: NavNode<AnyContext>; selectedIndex: number},
): boolean =>
	container.id === state.currentNode.id && state.selectedIndex === i;
