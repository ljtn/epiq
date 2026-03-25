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
};

export type AppEvent = AppEventMap[keyof AppEventMap]['event'];

type EventAction = keyof AppEventMap;

type EventResult<A extends EventAction> = AppEventMap[A]['result'];

export type MaterializeResult<E extends AppEvent> =
	| ReturnedSuccess<EventResult<E['action']>>
	| ReturnedNoSuccess;
