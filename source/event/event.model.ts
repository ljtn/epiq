import {Result} from '../lib/model/result-types.js';
import {Contributor, Tag} from '../lib/model/app-state.model.js';
import {AnyContext} from '../lib/model/context.model.js';
import {NavNode} from '../lib/model/navigation-node.model.js';

export type MovePosition =
	| {at: 'start'}
	| {at: 'end'}
	| {at: 'before'; sibling: string}
	| {at: 'after'; sibling: string};

export type PayloadBase = {id: string};

export type AppEventMap = {
	'init.workspace': {
		payload: PayloadBase & {name: string};
		result: NavNode<'WORKSPACE'>;
	};

	'add.workspace': {
		payload: PayloadBase & {name: string};
		result: NavNode<'WORKSPACE'>;
	};

	'add.board': {
		payload: PayloadBase & {name: string; parent: string};
		result: NavNode<'BOARD'>;
	};

	'add.swimlane': {
		payload: PayloadBase & {name: string; parent: string};
		result: NavNode<'SWIMLANE'>;
	};

	'add.issue': {
		payload: PayloadBase & {name: string; parent: string};
		result: NavNode<'TICKET'>;
	};

	'add.field': {
		payload: PayloadBase & {
			parent: string;
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

	'assign.issue': {
		payload: PayloadBase & {
			contributor: string;
			target: string;
		};
		result: NavNode<'FIELD'>;
	};
	'unassign.issue': {
		payload: PayloadBase & {
			contributor: string;
			target: string;
		};
		result: NavNode<'FIELD'>;
	};

	'tag.issue': {
		payload: PayloadBase & {
			tagId: string;
			target: string;
		};
		result: NavNode<'FIELD'>;
	};
	'untag.issue': {
		payload: PayloadBase & {
			tagId: string;
			target: string;
		};
		result: NavNode<'FIELD'>;
	};

	'move.node': {
		payload: PayloadBase & {
			parent: string;
			pos?: MovePosition;
		};
		result: NavNode<AnyContext>;
	};

	'edit.description': {
		payload: PayloadBase & {
			md: string;
		};
		result: {md: string};
	};

	'close.issue': {
		payload: PayloadBase & {parent: string};
		result: {id: string};
	};

	'reopen.issue': {
		payload: PayloadBase;
		result: {id: string};
	};

	'lock.node': {
		payload: PayloadBase;
		result: {id: string};
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
