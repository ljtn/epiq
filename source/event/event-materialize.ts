import {nodeRepo} from '../repository/node-repo.js';
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
		const {id, name, parent: parentId} = event.payload;
		const result = nodeRepo.createNodeAtPosition(
			nodes.board(id, name, parentId),
		);
		if (isFail(result)) return failed('Unable to create board');
		return succeeded('Added board', result.data);
	},

	'add.swimlane': event => {
		const {id, name, parent: parentId} = event.payload;
		const result = nodeRepo.createNodeAtPosition(
			nodes.swimlane(id, name, parentId),
		);
		if (isFail(result)) return failed('Unable to create swimlane');
		return succeeded('Added swimlane', result.data);
	},

	'add.issue': event => {
		const {id, name, parent: parentId} = event.payload;
		const result = nodeRepo.createNodeAtPosition(
			nodes.ticket(id, name, parentId),
		);
		if (isFail(result)) return failed('Unable to create issue');
		return succeeded('Added issue', result.data);
	},

	'add.field': event => {
		const {id, name, parent: parentId, val: value} = event.payload;
		const result = nodeRepo.createNodeAtPosition(
			nodes.field(
				id,
				name,
				parentId,
				{value},
				name.includes('Description') ? 'vertical' : 'horizontal',
			),
		);
		if (isFail(result)) return failed(`Unable to create field: ${name}`);
		return succeeded('Added field', result.data);
	},

	'edit.title': event => {
		const {id, val: value} = event.payload;
		const node = nodeRepo.getNode(id);
		if (!node) return failed('Unable to locate node');

		nodeRepo.updateNode({...node, title: value});
		return succeeded('Edited title', value);
	},

	'delete.node': event => {
		const {id} = event.payload;
		nodeRepo.tombstoneNode(id);
		return succeeded('Deleted node', id);
	},

	'create.tag': event => {
		const {id, name} = event.payload;
		const tag = nodeRepo.createTag({id, name});
		return succeeded('Tag added', tag.id);
	},

	'create.contributor': event => {
		const {id, name} = event.payload;
		const contributor = nodeRepo.createContributor({id, name});
		return succeeded('Contributor created', contributor.id);
	},

	'tag.issue': event => {
		const {id, target: targetId, tagId} = event.payload;
		const tagged = nodeRepo.tag(targetId, tagId, id);
		if (isFail(tagged)) return tagged;
		return succeeded('Issue tagged', tagged.data);
	},

	'assign.issue': event => {
		const {id, contributor: contributorId, target: targetId} = event.payload;
		const assigned = nodeRepo.assign(targetId, contributorId, id);
		if (isFail(assigned)) return assigned;
		return succeeded('Assigned successfully', assigned.data);
	},

	'move.node': event => {
		const {id, parent: parentId, pos: position} = event.payload;
		const moved = nodeRepo.moveNode(id, parentId, position);
		if (isFail(moved)) return failed('Failed to move node');
		return succeeded('Moved node', moved.data.id);
	},

	'edit.description': event => {
		const {target: targetId, md} = event.payload;
		const result = nodeRepo.editValue(targetId, md);
		if (isFail(result)) return result;
		return succeeded('Set node value', result.data);
	},
};

export type MaterializeResults<T extends readonly AppEvent[]> = {
	[K in keyof T]: T[K] extends AppEvent<infer A> ? MaterializeResult<A> : never;
};

export function materialize<A extends EventAction>(
	event: AppEvent<A>,
): MaterializeResult<A> {
	const handler = materializeHandlers[event.action] as (
		event: AppEvent<A>,
	) => MaterializeResult<A>;

	return handler(event);
}

export const materializeAll = <const T extends readonly AppEvent[]>(
	events: T,
): MaterializeResults<T> =>
	events.map(event => materialize(event)) as MaterializeResults<T>;
