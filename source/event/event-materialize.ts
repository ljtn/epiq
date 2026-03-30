import {ulid} from 'ulid';
import {nodeRepo} from '../lib/actions/add-item/node-repo.js';
import {failed, succeeded} from '../lib/command-line/command-types.js';
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
		nodeRepo.createNode(workspace);
		return succeeded('Workspace initialized', workspace);
	},

	'add.workspace': event => {
		const {id, name} = event.payload;
		const workspace = nodes.workspace(id, name);
		nodeRepo.createNode(workspace);
		return succeeded('Added workspace', workspace);
	},

	'add.board': event => {
		const {id, name, parentId} = event.payload;
		const board = nodeRepo.createNode(nodes.board(id, name, parentId));
		return succeeded('Added board', board);
	},

	'add.swimlane': event => {
		const {id, name, parentId} = event.payload;
		const swimlane = nodeRepo.createNode(nodes.swimlane(id, name, parentId));
		return succeeded('Added swimlane', swimlane);
	},

	'add.issue': event => {
		const {id, name, parentId} = event.payload;
		const issue = nodeRepo.createNode(nodes.ticket(id, name, parentId));
		nodeRepo.createNode(nodes.field(ulid(), 'Description', id, {value: ''}));
		nodeRepo.createNode(nodes.field(ulid(), 'Assignees', id, {value: ''}));
		nodeRepo.createNode(nodes.field(ulid(), 'Tags', id, {value: ''}));
		return succeeded('Added issue', issue);
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
		const {parentId, id} = event.payload;
		nodeRepo.tombstoneNode(parentId, id);
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
};

export function materialize<A extends EventAction>(
	event: AppEvent<A>,
): MaterializeResult<A> {
	return materializeHandlers[event.action](event);
}

export const materializeAll = <A extends EventAction>(events: AppEvent<A>[]) =>
	events.map(event => materialize(event));
