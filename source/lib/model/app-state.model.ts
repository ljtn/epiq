import {ActionEntry, ActionIndex, ModeUnion} from './action-map.model.js';
import {AnyContext} from './context.model.js';
import {NavNode} from './navigation-node.model.js';

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

export type ViewMode = 'wide' | 'dense';

export type AppState = {
	selectedIndex: number;
	currentNodeId: string;
	mode: ModeUnion;
	availableActions: ActionEntry[];
	actionIndex: ActionIndex;
	availableHints: string[];
	currentNode: NavNode<AnyContext>;
	breadCrumb: BreadCrumb;
	rootNodeId: string;
	nodes: Record<string, NavNode<AnyContext>>;
	viewMode: ViewMode;
};
