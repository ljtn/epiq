import {ulid} from 'ulid';
import {nodeRepo} from '../lib/actions/add-item/node-repo.js';
import {failed, isFail, succeeded} from '../lib/command-line/command-types.js';
import {nodes} from '../lib/state/node-builder.js';
import {initWorkspaceState} from '../lib/state/state.js';
import {AppEvent, EventAction, MaterializeResult} from './event.model.js';

type MaterializeHandlers = {
	[A in EventAction]: (event: AppEvent<A>) => MaterializeResult<A>;
};

const materializeHandlers: MaterializeHandlers = {
	'init.workspace': event => {
		const {id, name} = event.payload;
		const workspace = nodes.workspace(id, name);
		initWorkspaceState(workspace);
		nodeRepo.createNodeAtPosition(workspace);
		return succeeded('Workspace initialized', workspace);
	},

	'add.workspace': event => {
		const {id, name} = event.payload;
		const workspace = nodes.workspace(id, name);
		nodeRepo.createNodeAtPosition(workspace);
		return succeeded('Added workspace', workspace);
	},

	'add.board': event => {
		const {id, name, parentId} = event.payload;
		const result = nodeRepo.createNodeAtPosition(
			nodes.board(id, name, parentId),
		);
		if (isFail(result)) return failed('Unable to create board');
		return succeeded('Added board', result.data);
	},

	'add.swimlane': event => {
		const {id, name, parentId} = event.payload;
		const result = nodeRepo.createNodeAtPosition(
			nodes.swimlane(id, name, parentId),
		);
		if (isFail(result)) return failed('Unable to create swimlane');
		return succeeded('Added swimlane', result.data);
	},

	'add.issue': event => {
		const {id, name, parentId} = event.payload;
		const result = nodeRepo.createNodeAtPosition(
			nodes.ticket(id, name, parentId),
		);
		const description = nodeRepo.createNodeAtPosition(
			nodes.field(ulid(), 'Description', id, {value: ''}),
		);
		const assignees = nodeRepo.createNodeAtPosition(
			nodes.field(ulid(), 'Assignees', id, {value: ''}),
		);
		const tags = nodeRepo.createNodeAtPosition(
			nodes.field(ulid(), 'Tags', id, {value: ''}),
		);
		if (
			isFail(result) ||
			isFail(description) ||
			isFail(tags) ||
			isFail(assignees)
		)
			return failed('Unable to create issue');

		return succeeded('Added issue', result.data);
	},

	'edit.title': event => {
		const {id, value} = event.payload;
		const node = nodeRepo.getNode(id);
		if (!node) return failed('Unable to locate node');

		nodeRepo.updateNode({...node, title: value});
		return succeeded('Edited title', value);
	},

	'edit.description': event => {
		const {id, resourceId: _resourceId} = event.payload;
		const node = nodeRepo.getNode(id);
		if (!node) return failed('Unable to locate node');

		nodeRepo.updateNode({...node, title: 'REPLACE WITH RESOURCE ID'});
		return succeeded('Edited description', '');
	},

	'delete.node': event => {
		const {id} = event.payload;
		nodeRepo.tombstoneNode(id);
		return succeeded('Deleted node', id);
	},

	'tag.create': event => {
		const {id, name} = event.payload;
		const tag = nodeRepo.createTag({id, name});
		return succeeded('Tag added', tag.id);
	},

	'contributor.create': event => {
		const {id, name} = event.payload;
		const contributor = nodeRepo.createContributor({id, name});
		return succeeded('Contributor created', contributor.id);
	},

	'issue.tag': event => {
		const {targetId, tagId} = event.payload;
		nodeRepo.tag(targetId, tagId);
		return succeeded('Issue tagged', tagId);
	},

	'issue.assign': event => {
		const {contributorId, targetId} = event.payload;
		nodeRepo.assign(targetId, contributorId);
		return succeeded('Assigned successfully', undefined);
	},

	'move.node': event => {
		const {id, parentId, position} = event.payload;
		const moved = nodeRepo.moveNode(id, parentId, position);
		if (isFail(moved)) return failed('Failed to move node');
		return succeeded('Moved node', moved.data.id);
	},
};

export function materialize<A extends EventAction>(
	event: AppEvent<A>,
): MaterializeResult<A> {
	return materializeHandlers[event.action](event);
}

export const materializeAll = <A extends EventAction>(events: AppEvent<A>[]) =>
	events.map(event => materialize(event));
