import {ReturnFail, ReturnSuccess} from '../lib/command-line/command-types.js';
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
		payload: PayloadBase & {val: string};
		result: string;
	};

	'delete.node': {
		payload: PayloadBase;
		result: string;
	};

	'create.tag': {
		payload: PayloadBase & {name: string};
		result: string;
	};

	'create.contributor': {
		payload: PayloadBase & {name: string};
		result: string;
	};

	'assign.issue': {
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

	'move.node': {
		payload: PayloadBase & {
			parent: string;
			pos?: MovePosition;
		};
		result: string;
	};

	'edit.description': {
		payload: PayloadBase & {
			md: string;
		};
		result: {md: string};
	};
	'close.issue': {
		payload: PayloadBase;
		result: {id: string};
	};
	'reopen.issue': {
		payload: PayloadBase;
		result: {id: string};
	};
};

export type EventAction = keyof AppEventMap;

export type AppEvent<A extends EventAction = EventAction> =
	A extends EventAction
		? {
				action: A;
				payload: AppEventMap[A]['payload'];
		  }
		: never;

export type MaterializeResult<A extends EventAction> =
	| ReturnSuccess<AppEventMap[A]['result']>
	| ReturnFail;
