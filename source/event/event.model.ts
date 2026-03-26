import {
	ReturnedNoSuccess,
	ReturnedSuccess,
} from '../lib/command-line/command-types.js';
import {NavNode} from '../lib/model/navigation-node.model.js';

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
		payload: {id: string; name: string; parentId: string};
		result: NavNode<'BOARD'>;
	};

	'add.swimlane': {
		payload: {id: string; name: string; parentId: string};
		result: NavNode<'SWIMLANE'>;
	};

	'add.issue': {
		payload: {id: string; name: string; parentId: string};
		result: NavNode<'TICKET'>;
	};

	'edit.title': {
		payload: {id: string; value: string};
		result: string;
	};

	'edit.description': {
		payload: {id: string; resourceId: string; version: number};
		result: string;
	};

	'delete.node': {
		payload: {id: string; parentId: string};
		result: string;
	};

	'tag.create': {
		payload: {id: string; name: string};
		result: string;
	};

	'contributor.create': {
		payload: {id: string; name: string};
		result: string;
	};

	'issue.assign': {
		payload: {contributorId: string; targetId: string};
		result: void;
	};

	'issue.tag': {
		payload: {tagId: string; targetId: string};
		result: string;
	};
};

export type EventAction = keyof AppEventMap;

export type AppEvent<A extends EventAction = EventAction> = {
	action: A;
	payload: AppEventMap[A]['payload'];
};

export type EventResult<A extends EventAction> = AppEventMap[A]['result'];

export type MaterializeResult<A extends EventAction> =
	| ReturnedSuccess<EventResult<A>>
	| ReturnedNoSuccess;
