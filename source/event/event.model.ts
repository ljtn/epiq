import {ReturnFail, ReturnSuccess} from '../lib/command-line/command-types.js';
import {NavNode} from '../lib/model/navigation-node.model.js';

export type MovePosition =
	| {at: 'start'}
	| {at: 'end'}
	| {at: 'before'; sibling: string}
	| {at: 'after'; sibling: string};

export type AppEventMap = {
	'init.workspace': {
		payload: {id: string; name: string};
		result: NavNode<'WORKSPACE'>;
	};

	'add.workspace': {
		payload: {id: string; name: string};
		result: NavNode<'WORKSPACE'>;
	};

	'add.board': {
		payload: {id: string; name: string; parent: string};
		result: NavNode<'BOARD'>;
	};

	'add.swimlane': {
		payload: {id: string; name: string; parent: string};
		result: NavNode<'SWIMLANE'>;
	};

	'add.issue': {
		payload: {id: string; name: string; parent: string};
		result: NavNode<'TICKET'>;
	};

	'add.field': {
		payload: {
			id: string;
			parent: string;
			name: string;
			val?: string;
		};
		result: NavNode<'FIELD'>;
	};

	'edit.title': {
		payload: {id: string; val: string};
		result: string;
	};

	'delete.node': {
		payload: {id: string};
		result: string;
	};

	'create.tag': {
		payload: {id: string; name: string};
		result: string;
	};

	'create.contributor': {
		payload: {id: string; name: string};
		result: string;
	};

	'assign.issue': {
		payload: {
			id: string;
			contributor: string;
			target: string;
		};
		result: NavNode<'FIELD'>;
	};

	'tag.issue': {
		payload: {
			id: string;
			tagId: string;
			target: string;
		};
		result: NavNode<'FIELD'>;
	};

	'move.node': {
		payload: {
			id: string;
			parent: string;
			pos?: MovePosition;
		};
		result: string;
	};

	'edit.description': {
		payload: {
			target: string;
			md: string;
		};
		result: {md: string};
	};
};

export type EventAction = keyof AppEventMap;

export type AppEvent<A extends EventAction = EventAction> = {
	action: A;
	payload: AppEventMap[A]['payload'];
};

export type MaterializeResult<A extends EventAction> =
	| ReturnSuccess<AppEventMap[A]['result']>
	| ReturnFail;
