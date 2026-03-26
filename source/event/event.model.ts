import {
	ReturnedNoSuccess,
	ReturnedSuccess,
} from '../lib/command-line/command-types.js';
import {NavNode} from '../lib/model/navigation-node.model.js';

type AppEventMap = {
	'init.workspace': {
		event: {
			action: 'init.workspace';
			payload: {id: string; name: string};
		};
		result: NavNode<'WORKSPACE'>;
	};

	'add.workspace': {
		event: {
			action: 'add.workspace';
			payload: {id: string; name: string};
		};
		result: NavNode<'WORKSPACE'>;
	};

	'add.board': {
		event: {
			action: 'add.board';
			payload: {id: string; name: string; parentId: string};
		};
		result: NavNode<'BOARD'>;
	};

	'add.swimlane': {
		event: {
			action: 'add.swimlane';
			payload: {id: string; name: string; parentId: string};
		};
		result: NavNode<'SWIMLANE'>;
	};

	'add.issue': {
		event: {
			action: 'add.issue';
			payload: {id: string; name: string; parentId: string};
		};
		result: NavNode<'TICKET'>;
	};
	'edit.title': {
		event: {
			action: 'edit.title';
			payload: {id: string; value: string};
		};
		result: string;
	};
	'edit.description': {
		event: {
			action: 'edit.description';
			payload: {id: string; resourceId: string; version: number};
		};
		result: string;
	};
	'delete.node': {
		event: {
			action: 'delete.node';
			payload: {id: string; parentId: string};
		};
		result: string;
	};
	'tag.create': {
		event: {
			action: 'tag.create';
			payload: {id: string; name: string};
		};
		result: string;
	};

	'contributor.create': {
		event: {
			action: 'contributor.create';
			payload: {id: string; name: string};
		};
		result: string;
	};
	'issue.assign': {
		event: {
			action: 'issue.assign';
			payload: {contributorId: string; targetId: string};
		};
		result: string;
	};
	'issue.tag': {
		event: {
			action: 'issue.tag';
			payload: {tagId: string; targetId: string};
		};
		result: string;
	};
};

export type AppEvent = AppEventMap[keyof AppEventMap]['event'];

type EventAction = keyof AppEventMap;
type EventResult<A extends EventAction> = AppEventMap[A]['result'];

export type MaterializeResult<E extends AppEvent> =
	| ReturnedSuccess<EventResult<E['action']>>
	| ReturnedNoSuccess;
