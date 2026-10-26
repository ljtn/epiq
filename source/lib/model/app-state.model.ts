import {ActionHint} from '../hints/hints.js';
import {AppEvent} from '../../lib/board/board-events.model.js';
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

import {EmailLink} from './email-link.js';
import {RepoRegistry} from '../board/board-repos.js';

export type ViewMode = 'wide' | 'dense';

// A tombstoned tag keeps its id and record but reads as absent everywhere, and
// its name is free for a fresh tag.
export type Tag = {id: string; name: string; tombstoned?: boolean};
// A goal belongs to the project, its tickets to any board. Tombstoned, it
// keeps its record and every ticket's link to it, and reads as absent.
export type Goal = {id: string; name: string; tombstoned?: boolean};
// A placeholder, not an empty name, so a tombstoned assignee still reads as one.
export const REMOVED_CONTRIBUTOR_NAME = 'removed';

// `tombstoned` is a flag, not a placeholder-name check, so nobody genuinely
// called "removed" reads as removed.
export type Contributor = {
	id: string;
	name: string;
	userId?: string;
	tombstoned?: boolean;
};

export type Filter = {
	target:
		| 'tag'
		| 'goal'
		| 'assignee'
		| 'actor'
		| 'description'
		| 'title'
		| 'ref';
	operator: '=' | '!=';
	value: string;
};

export type SyncStatus = {
	// 'offline' is not a failure: local work is committed, the remote is not
	// reachable. 'failed' means something needs the user.
	status: 'synced' | 'failed' | 'offline' | 'pending' | 'syncing';
	msg: string;
};

// Progress of a `:replay <when>`: events re-applied from `startTime` up to the
// live edge (`endTime`); `currentTime` is the last applied event's time.
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
	/** Why the whole board is read-only, when something other than time travel set it. */
	readOnlyReason?: string;
	selectedIndex: number;
	selectedNode: NavNode<AnyContext> | null;
	contextNodeId: string | null;
	contextNode: NavNode<AnyContext>;
	filters: Filter[];
	contributors: Record<string, Contributor>;
	// Git author addresses bound to contributors, keyed by `emailLinkKey`; flat,
	// so an address two people claim is a readable state.
	emailLinks: Record<string, EmailLink>;
	// Connected repos by id, disconnected ones kept. Readers take the live
	// list from the log itself, which time travel does not rewind.
	repos: RepoRegistry;
	tags: Record<string, Tag>;
	goals: Record<string, Goal>;
	mode: ModeUnion;
	availableActions: ActionEntry[];
	actionIndex: ActionIndex;
	availableHints: ActionHint[];
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
	attachments: Record<string, AttachmentState>;
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
// The author is an id, resolved to a name at display time.
export type CommentState = {
	id: string;
	issue: string;
	authorId: string;
	md: string;
	deleted?: boolean;
};

export const ATTACHMENT_EXTENSIONS = ['png', 'jpg', 'gif', 'webp'] as const;

export type AttachmentExt = (typeof ATTACHMENT_EXTENSIONS)[number];

/** Attachment metadata; the bytes live as a blob at `.epiq/media/<hash>.<ext>`. */
export type AttachmentState = {
	id: string;
	issue: string;
	hash: string;
	ext: AttachmentExt;
	name: string;
	bytes: number;
	deleted?: boolean;
};
