import {nodeRepo} from '../lib/actions/add-item/node-repo.js';
import {
	failed,
	ReturnedSuccess,
	succeeded,
} from '../lib/command-line/command-types.js';
import {NavNode} from '../lib/model/navigation-node.model.js';
import {nodes} from '../lib/state/node-builder.js';
import {getState, initWorkspaceState} from '../lib/state/state.js';

type InitWorkspaceEvent = {
	action: 'init.workspace';
	payload: {
		name: string;
	};
};
type AddWorkspaceEvent = {
	action: 'add.workspace';
	payload: {
		name: string;
		parent: null;
	};
};

type AddBoardEvent = {
	action: 'add.board';
	payload: {
		name: string;
		parent: NavNode<'WORKSPACE'>;
	};
};

type AddSwimlaneEvent = {
	action: 'add.swimlane';
	payload: {
		name: string;
		parent: NavNode<'BOARD'>;
	};
};

type AddIssueEvent = {
	action: 'add.issue';
	payload: {
		name: string;
		parent: NavNode<'SWIMLANE'>;
	};
};

type AppEvent =
	| InitWorkspaceEvent
	| AddWorkspaceEvent
	| AddBoardEvent
	| AddSwimlaneEvent
	| AddIssueEvent;

export function playEvent(
	event: InitWorkspaceEvent,
): ReturnedSuccess<NavNode<'WORKSPACE'>>;
export function playEvent(
	event: AddWorkspaceEvent,
): ReturnedSuccess<NavNode<'WORKSPACE'>>;
export function playEvent(
	event: AddBoardEvent,
): ReturnedSuccess<NavNode<'BOARD'>>;
export function playEvent(
	event: AddSwimlaneEvent,
): ReturnedSuccess<NavNode<'SWIMLANE'>>;
export function playEvent(
	event: AddIssueEvent,
): ReturnedSuccess<NavNode<'TICKET'>>;
export function playEvent(event: AppEvent) {
	switch (event.action) {
		case 'init.workspace': {
			const workspace = nodes.workspace(event.payload.name);
			initWorkspaceState(workspace);
			nodeRepo.createNode(workspace);

			return succeeded('Workspace initialized', workspace);
		}
		case 'add.workspace': {
			// Unclear if we want to support this
			const workspace = nodes.workspace(event.payload.name);
			nodeRepo.createNode(workspace);

			return succeeded('Added workspace', workspace);
		}

		case 'add.board': {
			const {name, parent} = event.payload;
			const board = nodeRepo.createNode(nodes.board(name, parent.id));

			return succeeded('Added board', board);
		}

		case 'add.swimlane': {
			const {name, parent} = event.payload;
			const swimlane = nodeRepo.createNode(
				nodes.swimlane(name || 'New lane', parent.id),
			);

			return succeeded('Added swimlane', swimlane);
		}

		case 'add.issue': {
			const {name, parent} = event.payload;
			const issue = nodeRepo.createNode(nodes.ticket(name, parent.id));

			nodeRepo.createNode(nodes.field('Description', issue.id, ''));
			nodeRepo.createNode(nodes.fieldList('Assignees', issue.id));
			nodeRepo.createNode(nodes.fieldList('Tags', issue.id));

			logger.info(getState().nodes);
			return succeeded('Added issue', issue);
		}

		default: {
			return failed('No matching action');
		}
	}
}
