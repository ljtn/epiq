import {AppEvent} from '../../lib/event/event.model.js';
import {failed, Result, succeeded} from './result-types.js';
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
export type Contributor = {id: string; name: string; userId?: string};

export type Filter = {
	target: 'tag' | 'assignee' | 'description' | 'title';
	operator: '=' | '!=';
	value: string;
};

export type SyncStatus = {
	status: 'synced' | 'failed' | 'pending' | 'syncing';
	msg: string;
};

// Progress of a `:replay <when>` replay: the board is checked out at
// `startTime` and events are re-applied forward up to the live edge (`endTime`)
// like a movie. `currentTime` is the timestamp of the most recently applied
// event, which drives the topbar's progress/date visualization.
export type ReplayState = {
	// Elapsed playback position in [0..1], advancing with wall-clock time so the
	// scrubber keeps moving even while fast-forwarding through idle stretches.
	progress: number;
	appliedCount: number;
	totalCount: number;
	currentTime: number;
	startTime: number;
	endTime: number;
	// Human-readable summary of the most recently applied event (for the topbar
	// caption), and the node ids it touched (for the on-board flash highlight).
	currentLabel: string;
	flashNodeIds: string[];
};

export type AppState = {
	hasInitializingEvents: boolean;
	hasProjectDefinition: boolean;

	readOnly: boolean;
	selectedIndex: number;
	selectedNode: NavNode<AnyContext> | null;
	contextNodeId: string | null;
	contextNode: NavNode<AnyContext>;
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
	syncStatus: SyncStatus;

	// Time tracking
	timeMode: 'live' | 'peek' | 'replay';
	eventLog: AppEvent[];
	unappliedEvents: AppEvent[];
	replay: ReplayState | null;
	comments: Record<string, CommentState>;
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
export type CommentState = {
	id: string;
	issue: string;
	authorId: string;
	authorName: string;
	md: string;
	deleted?: boolean;
};
