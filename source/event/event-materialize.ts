import {failed, isFail, succeeded} from '../lib/command-line/command-types.js';
import {isTicketNode} from '../lib/model/context.model.js';
import {nodes} from '../lib/state/node-builder.js';
import {initWorkspaceState} from '../lib/state/state.js';
import {nodeRepo} from '../repository/node-repo.js';
import {AppEvent, EventAction, MaterializeResult} from './event.model.js';
import {resolveReopenParentFromLog} from './log-utils.js';
import {CLOSED_SWIMLANE_ID} from './static-ids.js';

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
		const moved = nodeRepo.moveNode({id, parentId, position});
		if (isFail(moved)) return failed('Failed to move node');
		return succeeded('Moved node', moved.data.id);
	},

	'edit.description': event => {
		const {id, md} = event.payload;
		const result = nodeRepo.editValue(id, md);
		if (isFail(result)) return result;
		return succeeded('Set node value', result.data);
	},

	// Works
	'close.issue': event => {
		const {id} = event.payload;
		const node = nodeRepo.getNode(id);
		const closeSwimlane = nodeRepo.getNode(CLOSED_SWIMLANE_ID);
		if (!closeSwimlane) return failed('Unable to locate target swimlane');
		const isClosed = closeSwimlane.id === node?.parentNodeId;
		if (isClosed) return failed('Cannot close closed issue');

		const result = nodeRepo.moveNode({
			id,
			parentId: closeSwimlane.id,
			navigate: false,
		});

		if (isFail(result)) return result;
		return succeeded('Issue closed', {id: result.data.id});
	},
	'reopen.issue': event => {
		const {id} = event.payload;
		const node = nodeRepo.getNode(id);

		if (!node) return failed('Unable to locate issue');
		if (!isTicketNode(node)) return failed('Can only reopen issues');

		const closeSwimlane = nodeRepo.getNode(CLOSED_SWIMLANE_ID);
		if (!closeSwimlane) return failed('Unable to locate closed swimlane');

		const isClosed = node.parentNodeId === closeSwimlane.id;
		if (!isClosed) return failed('Issue is not closed');

		const previousParentId = resolveReopenParentFromLog(node);
		if (!previousParentId) {
			return failed('Unable to resolve previous parent from issue history');
		}

		if (previousParentId === closeSwimlane.id) {
			return failed('Previous parent resolves to closed swimlane');
		}

		const previousParent = nodeRepo.getNode(previousParentId);
		if (!previousParent) {
			return failed('Previous parent no longer exists');
		}

		const result = nodeRepo.moveNode({
			id,
			parentId: previousParentId,
			navigate: false,
		});

		if (isFail(result)) return result;

		return succeeded('Issue reopened', {id: result.data.id});
	},
};

export type MaterializeResults<T extends readonly AppEvent[]> = {
	[K in keyof T]: T[K] extends AppEvent<infer A> ? MaterializeResult<A> : never;
};

const appendEventToNodeLog = (nodeId: string, event: AppEvent): void => {
	const node = nodeRepo.getNode(nodeId);
	if (!node) return;

	nodeRepo.updateNode({
		...node,
		log: [...(node.log ?? []), event],
	});
};

const getAffectedNodeIds = (event: AppEvent): string[] => {
	switch (event.action) {
		case 'init.workspace':
		case 'add.workspace':
		case 'add.board':
		case 'add.swimlane':
		case 'add.issue':
		case 'add.field':
		case 'edit.title':
		case 'delete.node':
		case 'move.node':
		case 'close.issue':
		case 'reopen.issue':
		case 'edit.description':
		case 'create.tag':
		case 'create.contributor':
			return [event.payload.id];

		case 'tag.issue':
			return [event.payload.id, event.payload.target];

		case 'assign.issue':
			return [event.payload.id, event.payload.target];

		default:
			return [];
	}
};

export function materialize<A extends EventAction>(
	event: AppEvent<A>,
): MaterializeResult<A> {
	const handler = materializeHandlers[event.action] as (
		event: AppEvent<A>,
	) => MaterializeResult<A>;

	const result = handler(event);

	if (!isFail(result)) {
		const affectedNodeIds = [...new Set(getAffectedNodeIds(event))];
		for (const nodeId of affectedNodeIds) {
			appendEventToNodeLog(nodeId, event);
		}
	}

	return result;
}

export const materializeAll = <const T extends readonly AppEvent[]>(
	events: T,
): MaterializeResults<T> =>
	events.map(event => materialize(event)) as MaterializeResults<T>;
