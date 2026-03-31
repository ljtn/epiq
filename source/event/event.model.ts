import {ReturnFail, ReturnSuccess} from '../lib/command-line/command-types.js';
import {NavNode} from '../lib/model/navigation-node.model.js';
type MovePosition =
	| {type: 'start'}
	| {type: 'end'}
	| {type: 'before'; siblingId: string}
	| {type: 'after'; siblingId: string};

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

	'add.field': {
		payload: {
			id: string;
			name: string;
			parentId: string;
			value: string;
		};
		result: NavNode<'FIELD'>;
	};

	'edit.title': {
		payload: {id: string; value: string};
		result: string;
	};

	'delete.node': {
		payload: {id: string};
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
	'move.node': {
		payload: {
			id: string;
			parentId: string;
			position?: MovePosition;
		};
		result: string;
	};
	'description.set': {
		payload: {
			targetId: string;
			markdown: string;
		};
		result: {markdown: string};
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
