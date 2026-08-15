import {Result} from '../model/result-types.js';
import {AttachmentExt, Contributor, Tag} from '../model/app-state.model.js';
import {AnyContext} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';

/**
 * All string references in event payloads are IDs unless otherwise noted.
 */

export type MovePosition =
	| {at: 'start'}
	| {at: 'end'}
	| {at: 'before'; sibling: string}
	| {at: 'after'; sibling: string};

export type Position = {
	parent: string;
	rank: string;
};

export type PayloadBase = {id: string};

export type AppEventMap = {
	'init.workspace': {
		payload: PayloadBase & {name: string; rank: string};
		result: NavNode<'WORKSPACE'>;
	};

	'add.workspace': {
		payload: PayloadBase & {name: string; rank: string};
		result: NavNode<'WORKSPACE'>;
	};

	'add.board': {
		payload: PayloadBase & {name: string} & Position;
		result: NavNode<'BOARD'>;
	};

	'add.swimlane': {
		payload: PayloadBase & {name: string} & Position;
		result: NavNode<'SWIMLANE'>;
	};

	'add.issue': {
		payload: PayloadBase & {name: string} & Position;
		result: NavNode<'TICKET'>;
	};

	/**
	 * Custom field definition/value node.
	 */
	'add.field': {
		payload: PayloadBase &
			Position & {
				name: string;
				val?: string;
			};
		result: NavNode<'FIELD'>;
	};

	'edit.title': {
		payload: PayloadBase & {name: string};
		result: NavNode<AnyContext>;
	};

	'delete.node': {
		payload: PayloadBase;
		result: NavNode<AnyContext>;
	};

	'create.tag': {
		payload: PayloadBase & {name: string};
		result: Tag;
	};

	'create.contributor': {
		payload: PayloadBase & {name: string};
		result: Contributor;
	};

	/**
	 * Clears a contributor's display name, keeping the id and its references.
	 * A forward event: the log is never rewritten, so earlier events still carry
	 * the name and replay unchanged.
	 */
	'tombstone.contributor': {
		payload: PayloadBase;
		result: Contributor;
	};

	/**
	 * Undoes a `tombstone.contributor`, which is recoverable because the guard on
	 * removal only sees the log this machine has pulled. Carries the name
	 * explicitly: reading it back off earlier events would make replay depend on
	 * which of them happen to be present.
	 */
	'restore.contributor': {
		payload: PayloadBase & {name: string};
		result: Contributor;
	};

	'add.issue.assignee': {
		payload: PayloadBase & {
			assignee: string;
		};
		result: {
			assignee: string;
		};
	};

	'remove.issue.assignee': {
		payload: PayloadBase & {
			assignee: string;
		};
		result: {
			assignee: string;
		};
	};

	'add.issue.tag': {
		payload: PayloadBase & {
			tag: string;
		};
		result: {
			tag: string;
		};
	};

	'remove.issue.tag': {
		payload: PayloadBase & {
			tag: string;
		};
		result: {
			tag: string;
		};
	};

	'move.node': {
		payload: PayloadBase & Position;
		result: NavNode<AnyContext>;
	};

	'edit.description': {
		payload: PayloadBase & {
			md: string;
		};
		result: {md: string};
	};

	'add.issue.comment': {
		payload: PayloadBase & {
			issue: string;
			author: string;
			md: string;
		};
		result: {
			id: string;
			issue: string;
			author: string;
			md: string;
		};
	};

	'edit.issue.comment': {
		payload: PayloadBase & {
			issue: string;
			md: string;
		};
		result: {
			id: string;
			issue: string;
			md: string;
		};
	};

	'delete.issue.comment': {
		payload: PayloadBase & {
			issue: string;
		};
		result: {
			id: string;
			issue: string;
		};
	};

	/**
	 * References a content-addressed blob at `.epiq/media/<hash>.<ext>` in
	 * the state branch worktree. The blob is written in the same commit as
	 * this event; blobs are immutable and never deleted so peek/replay can
	 * always render historical states.
	 */
	'add.issue.attachment': {
		payload: PayloadBase & {
			issue: string;
			author: string;
			hash: string;
			ext: AttachmentExt;
			name: string;
			bytes: number;
		};
		result: {
			id: string;
			issue: string;
			hash: string;
		};
	};

	/**
	 * Removes the attachment reference from the issue. The underlying blob
	 * stays on disk for time travel.
	 */
	'delete.issue.attachment': {
		payload: PayloadBase & {
			issue: string;
		};
		result: {
			id: string;
			issue: string;
		};
	};

	'close.issue': {
		payload: PayloadBase & Position;
		result: {id: string};
	};

	'reopen.issue': {
		payload: PayloadBase & Position;
		result: {id: string};
	};

	'lock.node': {
		payload: PayloadBase;
		result: {id: string};
	};

	'rebalance.children': {
		payload: {
			parent: string;
			ranks: Record<string, string>;
		};
		result: {parent: string};
	};

	'link.contributor.user': {
		payload: {
			contributor: string;
		};
		result: {
			contributor: string;
			userId: string;
		};
	};
};

export type EventAction = keyof AppEventMap;

/**
 * Runtime registry of every action this version understands. Events with
 * actions outside this list (written by a newer epiq) are skipped on load
 * instead of failing replay.
 */
export const EVENT_ACTIONS = [
	'init.workspace',
	'add.workspace',
	'add.board',
	'add.swimlane',
	'add.issue',
	'add.field',
	'edit.title',
	'delete.node',
	'create.tag',
	'create.contributor',
	'tombstone.contributor',
	'restore.contributor',
	'add.issue.assignee',
	'remove.issue.assignee',
	'add.issue.tag',
	'remove.issue.tag',
	'move.node',
	'edit.description',
	'add.issue.comment',
	'edit.issue.comment',
	'delete.issue.comment',
	'add.issue.attachment',
	'delete.issue.attachment',
	'close.issue',
	'reopen.issue',
	'lock.node',
	'rebalance.children',
	'link.contributor.user',
] as const satisfies readonly EventAction[];

// Compile-time proof that EVENT_ACTIONS covers every EventAction.
type MissingActions = Exclude<EventAction, (typeof EVENT_ACTIONS)[number]>;
const _assertAllActionsListed: MissingActions extends never ? true : never =
	true;
void _assertAllActionsListed;

const knownEventActions: ReadonlySet<string> = new Set(EVENT_ACTIONS);

export const isKnownEventAction = (action: string): action is EventAction =>
	knownEventActions.has(action);

type StoredAppEventUnion = {
	[A in EventAction]: {
		action: A;
		payload: AppEventMap[A]['payload'];
	};
}[EventAction];

type AppEventUnion = {
	[A in EventAction]: {
		action: A;
		payload: AppEventMap[A]['payload'];
	};
}[EventAction];

export type StoredAppEvent<A extends EventAction = EventAction> = Extract<
	StoredAppEventUnion,
	{action: A}
>;

type LogicalEvent<A extends EventAction = EventAction> = Extract<
	AppEventUnion,
	{action: A}
>;

export type AppEvent<A extends EventAction = EventAction> = LogicalEvent<A> & {
	id: string;
	userId: string;
	userName: string;
};

export type MaterializeResult<A extends EventAction> = Result<{
	action: A;
	result: AppEventMap[A]['result'];
}>;

export const stripActor = <A extends EventAction>(
	event: AppEvent<A>,
): StoredAppEvent<A> =>
	({
		action: event.action,
		payload: event.payload,
	} as StoredAppEvent<A>);
