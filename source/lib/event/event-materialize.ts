import {isTicketNode} from '../model/context.model.js';
import {failed, isFail, ReturnFail, succeeded} from '../model/result-types.js';
import {nodeRepo} from '../repository/node-repo.js';
import {nodes} from '../state/node-builder.js';
import {getState, initWorkspaceState, updateState} from '../state/state.js';
import {AppEvent, EventAction, MaterializeResult} from './event.model.js';
import {CLOSED_SWIMLANE_ID} from './static-ids.js';

type MaterializeHandlers = {
	[A in EventAction]: (event: AppEvent<A>) => MaterializeResult<A>;
};

export type MaterializeResults<T extends readonly AppEvent[]> = {
	[K in keyof T]: T[K] extends AppEvent<infer A> ? MaterializeResult<A> : never;
};

const materializeFail = <A extends AppEvent>(
	msg: string,
	event: A,
): ReturnFail =>
	failed(
		`${
			event.action.split('.').join(' ') + ' failed, ' + msg.toLowerCase()
		}. Evt id: ${event.id}`,
	);

const materializeHandlers: MaterializeHandlers = {
	'init.workspace': event => {
		const {id, name} = event.payload;
		const workspace = nodes.workspace(id, name);
		initWorkspaceState(workspace);

		const result = nodeRepo.createNodeAtPosition(workspace);
		if (isFail(result)) {
			return materializeFail(
				result.message ?? 'Failed to initialize workspace',
				event,
			);
		}

		return succeeded('Workspace initialized', {
			action: event.action,
			result: result.value,
		});
	},

	'add.workspace': event => {
		const {id, name} = event.payload;
		const workspace = nodes.workspace(id, name);

		const result = nodeRepo.createNodeAtPosition(workspace);
		if (isFail(result)) {
			return materializeFail(
				result.message ?? 'Failed to add workspace',
				event,
			);
		}

		return succeeded('Added workspace', {
			action: event.action,
			result: result.value,
		});
	},

	'add.board': event => {
		const {id, name, parent: parentId} = event.payload;
		const result = nodeRepo.createNodeAtPosition(
			nodes.board(id, name, parentId),
		);

		if (isFail(result)) {
			return materializeFail(result.message ?? 'Unable to create board', event);
		}

		return succeeded('Added board', {
			action: event.action,
			result: result.value,
		});
	},

	'add.swimlane': event => {
		const {id, name, parent: parentId} = event.payload;
		const result = nodeRepo.createNodeAtPosition(
			nodes.swimlane(id, name, parentId),
		);

		if (isFail(result)) {
			return materializeFail(
				result.message ?? 'Unable to create swimlane',
				event,
			);
		}

		return succeeded('Added swimlane', {
			action: event.action,
			result: result.value,
		});
	},

	'add.issue': event => {
		const {id, name, parent: parentId} = event.payload;
		const result = nodeRepo.createNodeAtPosition(
			nodes.ticket(id, name, parentId),
		);

		if (isFail(result)) {
			return materializeFail(result.message ?? 'Unable to create issue', event);
		}

		return succeeded('Added issue', {
			action: event.action,
			result: result.value,
		});
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

		if (isFail(result)) {
			return materializeFail(
				result.message ?? `Unable to create field: ${name}`,
				event,
			);
		}

		return succeeded('Added field', {
			action: event.action,
			result: result.value,
		});
	},

	'edit.title': event => {
		const {id, name: value} = event.payload;
		const node = nodeRepo.getNode(id);
		if (!node)
			return materializeFail(`Unable to locate node with id ${id}`, event);

		const result = nodeRepo.renameNode(id, value);
		if (isFail(result)) {
			return materializeFail(result.message ?? 'Unable to edit title', event);
		}

		return succeeded('Edited title', {
			action: event.action,
			result: result.value,
		});
	},

	'delete.node': event => {
		const {id} = event.payload;
		const result = nodeRepo.tombstoneNode(id);

		if (isFail(result)) {
			return materializeFail(result.message ?? 'Unable to delete node', event);
		}

		return succeeded('Deleted node', {
			action: event.action,
			result: result.value,
		});
	},

	'create.tag': event => {
		const {id, name} = event.payload;
		const result = nodeRepo.createTag({id, name});

		if (isFail(result)) {
			return materializeFail(result.message ?? 'Unable to create tag', event);
		}

		return succeeded('Tag added', {
			action: event.action,
			result: result.value,
		});
	},

	'create.contributor': event => {
		const {id, name} = event.payload;
		const result = nodeRepo.createContributor({id, name});

		if (isFail(result)) {
			return materializeFail(
				result.message ?? 'Unable to create contributor',
				event,
			);
		}

		return succeeded('Contributor created', {
			action: event.action,
			result: result.value,
		});
	},

	'tag.issue': event => {
		const {id, target: targetId, tagId} = event.payload;
		const tagged = nodeRepo.tag(targetId, tagId, id);

		if (isFail(tagged)) {
			return materializeFail(tagged.message ?? 'Unable to tag issue', event);
		}

		return succeeded('Issue tagged', {
			action: event.action,
			result: tagged.value,
		});
	},

	'untag.issue': event => {
		const {target: targetId, tagId} = event.payload;
		const tagged = nodeRepo.untag(targetId, tagId);

		if (isFail(tagged)) {
			return materializeFail(tagged.message ?? 'Unable to untag ', event);
		}

		return succeeded('Issue untagged', {
			action: event.action,
			result: tagged.value,
		});
	},

	'assign.issue': event => {
		const {id, contributor: contributorId, target: targetId} = event.payload;
		const result = nodeRepo.assign(targetId, contributorId, id);

		if (isFail(result)) {
			return materializeFail(result.message ?? 'Unable to assign issue', event);
		}

		return succeeded('Assigned successfully', {
			action: event.action,
			result: result.value,
		});
	},

	'unassign.issue': event => {
		const {target: targetId, contributor} = event.payload;
		const result = nodeRepo.unassign(targetId, contributor);

		if (isFail(result)) {
			return materializeFail(
				result.message ?? 'Unable to unassign issue',
				event,
			);
		}

		return succeeded('Issue unassigned', {
			action: event.action,
			result: result.value,
		});
	},

	'move.node': event => {
		const {id, parent: parentId, rank} = event.payload;

		const result = nodeRepo.moveNodeToRank({
			id,
			parentId,
			rank,
		});

		if (isFail(result)) {
			return materializeFail(result.message ?? 'Failed to move node', event);
		}

		return succeeded('Moved node', {
			action: event.action,
			result: result.value,
		});
	},

	'edit.description': event => {
		const {id, md} = event.payload;
		const result = nodeRepo.editValue(id, md);

		if (isFail(result)) {
			return materializeFail(
				result.message ?? 'Unable to edit description',
				event,
			);
		}

		return succeeded('Set node value', {
			action: event.action,
			result: result.value,
		});
	},

	'close.issue': event => {
		const {id, parent: parentId, rank} = event.payload;
		const node = nodeRepo.getNode(id);
		if (!node) return materializeFail('Unable to locate issue', event);
		if (!isTicketNode(node))
			return materializeFail('Can only close issues', event);

		const closeSwimlane = nodeRepo.getNode(CLOSED_SWIMLANE_ID);
		if (!closeSwimlane) {
			return materializeFail('Unable to locate target swimlane', event);
		}

		if (parentId !== closeSwimlane.id) {
			return materializeFail('Close target must be closed swimlane', event);
		}

		const result = nodeRepo.moveNodeToRank({
			id,
			parentId,
			rank,
		});

		if (isFail(result)) {
			return materializeFail(result.message ?? 'Unable to close issue', event);
		}

		return succeeded('Issue closed', {
			action: event.action,
			result: {id},
		});
	},

	'reopen.issue': event => {
		const {id, parent: parentId, rank} = event.payload;
		const node = nodeRepo.getNode(id);

		if (!node) return materializeFail('Unable to locate issue', event);
		if (!isTicketNode(node))
			return materializeFail('Can only reopen issues', event);

		const closeSwimlane = nodeRepo.getNode(CLOSED_SWIMLANE_ID);
		if (!closeSwimlane) {
			return materializeFail('Unable to locate closed swimlane', event);
		}

		if (parentId === closeSwimlane.id) {
			return materializeFail('Cannot reopen issue into closed swimlane', event);
		}

		const previousParent = nodeRepo.getNode(parentId);
		if (!previousParent) {
			return materializeFail('Reopen parent no longer exists', event);
		}

		const result = nodeRepo.moveNodeToRank({
			id,
			parentId,
			rank,
		});

		if (isFail(result)) {
			return materializeFail(result.message ?? 'Unable to reopen issue', event);
		}

		return succeeded('Issue reopened', {
			action: event.action,
			result: {id},
		});
	},

	'lock.node': event => {
		const {id} = event.payload;
		const result = nodeRepo.lockNode(id);

		if (isFail(result)) {
			return materializeFail(result.message ?? 'Unable to lock node', event);
		}

		return succeeded('Node locked', {
			action: event.action,
			result: result.value,
		});
	},
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
		case 'lock.node':
		case 'delete.node':
		case 'move.node':
		case 'close.issue':
		case 'reopen.issue':
			return [event.payload.id];
		case 'edit.description':
			const ids = [event.payload.id];
			const parentId = getState().nodes[event.payload.id]?.parentNodeId;
			if (parentId) ids.push(parentId);
			return ids;

		case 'tag.issue':
		case 'untag.issue':
		case 'assign.issue':
		case 'unassign.issue':
			return [event.payload.id, event.payload.target];

		case 'create.tag':
		case 'create.contributor':
		default:
			return [];
	}
};

export function materialize<A extends EventAction>(
	event: AppEvent<A>,
	bypassLogging = false,
): MaterializeResult<A> {
	const result = materializeHandlers[event.action](event);
	if (isFail(result)) return result;

	if (!bypassLogging) {
		const affectedNodeIds = [...new Set(getAffectedNodeIds(event))];
		affectedNodeIds.forEach(nodeId => appendEventToNodeLog(nodeId, event));
		updateState(s => ({...s, eventLog: [...s.eventLog, event]}));
	}

	const id = event.userId;
	const name = event.userName;
	if (!id?.length || !name?.length) {
		return materializeFail('Invalid user ID format', event);
	}
	nodeRepo.createContributor({name, id});

	return result;
}

export const materializeAll = <const T extends readonly AppEvent[]>(
	events: T,
): MaterializeResults<T> =>
	events.map(event => materialize(event)) as MaterializeResults<T>;
