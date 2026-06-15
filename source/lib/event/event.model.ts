import {Result} from '../model/result-types.js';
import {Contributor, Tag} from '../model/app-state.model.js';
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
