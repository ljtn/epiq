import {ulid} from 'ulid';
import {nodeRepo} from '../lib/actions/add-item/node-repo.js';
import {failed, succeeded} from '../lib/command-line/command-types.js';
import {nodes} from '../lib/state/node-builder.js';
import {initWorkspaceState} from '../lib/state/state.js';
import {AppEvent, MaterializeResult} from './event.model.js';

export function materialize<E extends AppEvent>(
	event: E,
): MaterializeResult<E> {
	switch (event.action) {
		case 'init.workspace': {
			const {id, name} = event.payload;
			const workspace = nodes.workspace(id, name);
			initWorkspaceState(workspace);
			nodeRepo.createNode(workspace);
			return succeeded(
				'Workspace initialized',
				workspace,
			) as MaterializeResult<E>;
		}

		case 'add.workspace': {
			const {id, name} = event.payload;
			const workspace = nodes.workspace(id, name);
			nodeRepo.createNode(workspace);
			return succeeded('Added workspace', workspace) as MaterializeResult<E>;
		}

		case 'add.board': {
			const {id, name, parentId} = event.payload;
			const board = nodeRepo.createNode(nodes.board(id, name, parentId));
			return succeeded('Added board', board) as MaterializeResult<E>;
		}

		case 'add.swimlane': {
			const {id, name, parentId} = event.payload;
			const swimlane = nodeRepo.createNode(nodes.swimlane(id, name, parentId));
			return succeeded('Added swimlane', swimlane) as MaterializeResult<E>;
		}

		case 'add.issue': {
			const {id, name, parentId} = event.payload;
			const issue = nodeRepo.createNode(nodes.ticket(id, name, parentId));
			nodeRepo.createNode(nodes.field(ulid(), 'Description', id, {value: ''}));
			nodeRepo.createNode(nodes.field(ulid(), 'Assignees', id, {value: ''}));
			nodeRepo.createNode(nodes.field(ulid(), 'Tags', id, {value: ''}));
			return succeeded('Added issue', issue) as MaterializeResult<E>;
		}
		case 'edit.title': {
			const {id, value} = event.payload;
			const node = nodeRepo.getNode(id);
			if (!node) return failed('Unable to locate node') as MaterializeResult<E>;

			nodeRepo.updateNode({...node, title: value});

			return succeeded('Edited title', value) as MaterializeResult<E>;
		}
		case 'edit.description': {
			const {id, resourceId: _resourceId} = event.payload;
			const node = nodeRepo.getNode(id);
			if (!node) return failed('Unable to locate node') as MaterializeResult<E>;

			nodeRepo.updateNode({...node, title: 'REPLACE WITH RESOURCE ID'});
			return succeeded('Edited description', '') as MaterializeResult<E>;
		}

		case 'delete.node': {
			const {parentId, id} = event.payload;
			nodeRepo.deleteNode(parentId, id);
			return succeeded('Deleted node', id) as MaterializeResult<E>;
		}

		case 'tag.create': {
			const {id, name} = event.payload;
			const tag = nodeRepo.createTag({id, name});
			return succeeded('Tag added', tag.id) as MaterializeResult<E>;
		}

		case 'contributor.create': {
			const {id, name} = event.payload;
			const assignee = nodeRepo.createContributor({id, name});
			return succeeded('Contributor created', assignee) as MaterializeResult<E>;
		}

		case 'issue.tag': {
			const {targetId, tagId} = event.payload;
			return nodeRepo.tag(targetId, tagId) as MaterializeResult<E>;
		}

		case 'issue.assign': {
			const {contributorId, targetId} = event.payload;
			nodeRepo.assign(targetId, contributorId);
			return succeeded('Assigned successfully') as MaterializeResult<E>;
		}
	}
}

export const materializeAll = <E extends AppEvent>(events: E[]) =>
	events.map(event => materialize(event));
