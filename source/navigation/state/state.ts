import {Hints} from '../../board/hints/hints.js';
import {AnyContext, Board, Workspace} from '../../board/model/context.model.js';
import {renderWorkspace} from '../../cli.js';
import {contextActions} from '../actions/board-action-map.js';
import {DefaultActions} from '../actions/default/default-actions.js';
import {inputActions} from '../actions/input/input-actions.js';
import {ActionEntry, ModeUnion} from '../model/action-map.model.js';
import {NavNode} from '../model/navigation-node.model.js';

export type BreadCrumb =
	| [NavNode<'WORKSPACE'>]
	| [NavNode<'WORKSPACE'>, NavNode<'BOARD'>]
	| [NavNode<'WORKSPACE'>, NavNode<'BOARD'>, NavNode<'SWIMLANE'>]
	| [
			NavNode<'WORKSPACE'>,
			NavNode<'BOARD'>,
			NavNode<'SWIMLANE'>,
			NavNode<'TICKET_LIST_ITEM'>,
	  ]
	| [
			NavNode<'WORKSPACE'>,
			NavNode<'BOARD'>,
			NavNode<'SWIMLANE'>,
			NavNode<'TICKET_LIST_ITEM'>,
			NavNode<'TICKET'>,
	  ];
export type AppState = {
	readonly selectedIndex: number;
	readonly mode: ModeUnion;
	readonly availableActions: ActionEntry[];
	readonly availableHints: readonly string[];
	readonly currentNode: NavNode<AnyContext>;
	readonly breadCrumb: BreadCrumb;
	readonly rootNode: Workspace;
};

export let appState: AppState;

const derived = (state: typeof appState): typeof appState => {
	const {currentNode, mode} = state;

	const availableHints =
		Hints[currentNode.context + mode] ?? Hints[currentNode.context];

	const actionContext = currentNode?.context;
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

export const initWorkspaceState = (workspace: Workspace) => {
	const selectedBoard = workspace.children.at(0) as Board;
	appState = derived({
		...appState,
		rootNode: workspace,
		breadCrumb: [workspace, selectedBoard],
		selectedIndex: 0,
		mode: 'default',
		currentNode: selectedBoard,
	});
	renderWorkspace();
};

export const updateState = (
	cb: (oldState: typeof appState) => typeof appState,
	opts: {render?: boolean} = {render: true},
) => {
	appState = derived(cb(appState));
	if (opts.render) renderWorkspace();
};

export const patchState = (
	patch: Partial<typeof appState>,
	opts: {render?: boolean} = {render: true},
) => updateState(old => ({...old, ...patch}), opts);
