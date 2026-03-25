import {ulid} from 'ulid';
import {
	failed,
	ReturnedSuccess,
	succeeded,
} from '../lib/command-line/command-types.js';
import {NavNode} from '../lib/model/navigation-node.model.js';
import {nodeBuilder} from '../lib/state/node-builder.js';
import {initWorkspaceState} from '../lib/state/state.js';
import {nodeRepo} from '../lib/actions/add-item/node-repo.js';

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
			const workspace = nodeBuilder.workspace(event.payload.name);
			initWorkspaceState(workspace);
			nodeRepo.createNode(workspace);

			return succeeded('Workspace initialized', workspace);
		}
		case 'add.workspace': {
			// Unclear if we want to support this
			const workspace = nodeBuilder.workspace(event.payload.name);
			nodeRepo.createNode(workspace);

			return succeeded('Added workspace', workspace);
		}

		case 'add.board': {
			const {name, parent} = event.payload;
			const board = nodeBuilder.board(name, parent.id);
			nodeRepo.appendChildToNode(parent.id, board);

			return succeeded('Added board', board);
		}

		case 'add.swimlane': {
			const {name, parent} = event.payload;
			const swimlane = nodeBuilder.swimlane(name || 'New lane', parent.id);
			nodeRepo.appendChildToNode(parent.id, swimlane);

			return succeeded('Added swimlane', swimlane);
		}

		case 'add.issue': {
			const {name, parent} = event.payload;

			const ticketId = ulid();
			const descriptionField = nodeBuilder.field('Description', ticketId);
			const assigneesField = nodeBuilder.fieldList('Assignees', ticketId);
			const tagsField = nodeBuilder.fieldList('Tags', ticketId);

			const issue = nodeBuilder.ticket(name, parent.id, [
				descriptionField.id,
				assigneesField.id,
				tagsField.id,
			]);

			nodeRepo.createNode(descriptionField);
			nodeRepo.createNode(assigneesField);
			nodeRepo.createNode(tagsField);

			nodeRepo.appendChildToNode(issue.id, descriptionField);
			nodeRepo.appendChildToNode(issue.id, assigneesField);
			nodeRepo.appendChildToNode(issue.id, tagsField);

			nodeRepo.appendChildToNode(parent.id, issue);

			return succeeded('Added issue', issue);
		}

		default: {
			return failed('No matching action');
		}
	}
}
