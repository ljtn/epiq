import {AppEvent} from '../../event/event.model.js';
import {failed, Result, succeeded} from '../command-line/command-types.js';
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

export type Tag = {id: string; name: string};
export type Contributor = {id: string; name: string};

export type Filter = {
	target: 'tag' | 'assignee' | 'description' | 'title';
	operator: '=' | '!=';
	value: string;
};

export type SyncStatus = {
	status: 'synced' | 'outOfSync' | 'syncing';
	msg: string;
};

export type AppState = {
	readOnly: boolean;
	selectedIndex: number;
	selectedNode: NavNode<AnyContext> | null;
	currentNodeId: string | null;
	currentNode: NavNode<AnyContext>;
	filters: Filter[];
	contributors: Record<string, Contributor>;
	tags: Record<string, Tag>;
	mode: ModeUnion;
	availableActions: ActionEntry[];
	actionIndex: ActionIndex;
	availableHints: string[];
	breadCrumb: BreadCrumb;
	rootNodeId: string;
	nodes: Record<string, NavNode<AnyContext>>;
	renderedChildrenIndex: Record<string, NavNode<AnyContext>[]>; // parent -> children mapping
	viewMode: ViewMode;
	syncStatus: SyncStatus;

	// Time tracking
	timeMode: 'live' | 'peek' | 'replay';
	eventLog: AppEvent[];
	unappliedEvents: AppEvent[];
};

type BreadCrumbItem = BreadCrumb[number];

export const findInBreadCrumb = <T extends BreadCrumbItem['context']>(
	breadCrumb: BreadCrumb,
	type: T,
): Result<BreadCrumbItem> => {
	const node = (breadCrumb as readonly BreadCrumbItem[]).find(
		(node): node is Extract<BreadCrumbItem, {context: T}> =>
			node.context === type,
	);
	if (node !== undefined) {
		return succeeded('Found node', node);
	} else {
		return failed('Unable to find node in breadcrumb');
	}
};
