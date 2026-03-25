import {ulid} from 'ulid';
import {nodeRepo} from '../lib/actions/add-item/node-repo.js';
import {succeeded} from '../lib/command-line/command-types.js';
import {nodes} from '../lib/state/node-builder.js';
import {initWorkspaceState} from '../lib/state/state.js';
import {AppEvent, PlayEventResult} from './event.model.js';

export function materialize<E extends AppEvent>(event: E): PlayEventResult<E> {
	switch (event.action) {
		case 'init.workspace': {
			const {id, name} = event.payload;
			const workspace = nodes.workspace(id, name);
			initWorkspaceState(workspace);
			nodeRepo.createNode(workspace);
			return succeeded(
				'Workspace initialized',
				workspace,
			) as PlayEventResult<E>;
		}

		case 'add.workspace': {
			const {id, name} = event.payload;
			const workspace = nodes.workspace(id, name);
			nodeRepo.createNode(workspace);
			return succeeded('Added workspace', workspace) as PlayEventResult<E>;
		}

		case 'add.board': {
			const {id, name, parentId} = event.payload;
			const board = nodeRepo.createNode(nodes.board(id, name, parentId));
			return succeeded('Added board', board) as PlayEventResult<E>;
		}

		case 'add.swimlane': {
			const {id, name, parentId} = event.payload;
			const swimlane = nodeRepo.createNode(nodes.swimlane(id, name, parentId));
			return succeeded('Added swimlane', swimlane) as PlayEventResult<E>;
		}

		case 'add.issue': {
			const {id, name, parentId} = event.payload;
			const issue = nodeRepo.createNode(nodes.ticket(id, name, parentId));
			nodeRepo.createNode(nodes.field(ulid(), 'Description', id, ''));
			nodeRepo.createNode(nodes.fieldList(ulid(), 'Assignees', id));
			nodeRepo.createNode(nodes.fieldList(ulid(), 'Tags', id));
			return succeeded('Added issue', issue) as PlayEventResult<E>;
		}
	}
}

export const materializeAll = <E extends AppEvent>(events: E[]) =>
	events.map(event => materialize(event));
