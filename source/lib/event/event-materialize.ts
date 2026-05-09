import {
	isBoardNode,
	isFieldNode,
	isSwimlaneNode,
	isTicketNode,
	isWorkspaceNode,
} from '../model/context.model.js';
import {failed, isFail, ReturnFail, succeeded} from '../model/result-types.js';
import {FieldNames} from '../repository/fielNames.js';
import {nodeRepo} from '../repository/node-repo.js';
import {nodes} from '../state/node-builder.js';
import {getState, initWorkspaceState, updateState} from '../state/state.js';
import {materializeTicketVirtualNodes} from '../virtual-nodes/virtual-nodes.js';
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

const refreshTicketVirtualNodes = (nodeId: string): void => {
	const node = nodeRepo.getNode(nodeId);

	if (!node || !isTicketNode(node) || node.isDeleted) return;

	materializeTicketVirtualNodes(node);
};

const refreshAffectedVirtualNodes = (nodeIds: string[]): void => {
	for (const nodeId of nodeIds) {
		refreshTicketVirtualNodes(nodeId);

		const parentId = getState().nodes[nodeId]?.parentNodeId;
		if (parentId) refreshTicketVirtualNodes(parentId);
	}
};

const appendEventToNodeLog = (nodeId: string, event: AppEvent): void => {
	const node = nodeRepo.getNode(nodeId);
	if (!node) return;

	nodeRepo.updateNode({
		...node,
		log: [...(node.log ?? []), event],
	});
};

const getNodeIdWithParent = (nodeId: string): string[] => {
	const ids = [nodeId];
	const parentId = getState().nodes[nodeId]?.parentNodeId;

	if (parentId) ids.push(parentId);

	return ids;
};

const getAffectedNodeIds = (event: AppEvent): string[] => {
	switch (event.action) {
		case 'delete.node':
		case 'edit.description':
			return getNodeIdWithParent(event.payload.id);

		case 'init.workspace':
		case 'add.workspace':
		case 'add.board':
		case 'add.swimlane':
		case 'add.issue':
		case 'add.field':
		case 'edit.title':
		case 'lock.node':
		case 'move.node':
		case 'close.issue':
		case 'reopen.issue':
		case 'add.issue.tag':
		case 'remove.issue.tag':
		case 'add.issue.assignee':
		case 'remove.issue.assignee':
			return [event.payload.id];

		case 'rebalance.children':
			return Object.keys(event.payload.ranks);

		case 'create.tag':
		case 'create.contributor':
		default:
			return [];
	}
};

const appendEventToAppLog = (event: AppEvent): void => {
	updateState(s => ({
		...s,
		eventLog: [...s.eventLog, event],
	}));
};

const materializeEventUser = (event: AppEvent): ReturnFail | null => {
	const id = event.userId;
	const name = event.userName;

	if (!id?.length || !name?.length) {
		return materializeFail('Invalid user ID format', event);
	}

	const result = nodeRepo.createContributor({id, name});
	if (isFail(result)) return materializeFail(result.message, event);

	return null;
};

const completeMaterialization = (
	event: AppEvent,
	bypassLogging: boolean,
): ReturnFail | null => {
	const userFail = materializeEventUser(event);
	if (userFail) return userFail;

	const affectedNodeIds = [...new Set(getAffectedNodeIds(event))];

	if (!bypassLogging) {
		affectedNodeIds.forEach(nodeId => appendEventToNodeLog(nodeId, event));
		appendEventToAppLog(event);
	}

	refreshAffectedVirtualNodes(affectedNodeIds);

	return null;
};

const materializeHandlers: MaterializeHandlers = {
	'init.workspace': event => {
		const {id, name, rank} = event.payload;
		const workspace = nodes.workspace(id, name, rank);

		const initResult = initWorkspaceState(workspace);
		if (isFail(initResult)) {
			return materializeFail(initResult.message, event);
		}

		const result = nodeRepo.createNode(workspace);
		if (isFail(result)) {
			return materializeFail(
				result.message ?? 'Failed to initialize workspace',
				event,
			);
		}

		if (!isWorkspaceNode(result.value)) {
			return failed('Unexpected create node return value');
		}

		return succeeded('Workspace initialized', {
			action: event.action,
			result: result.value,
		});
	},

	'add.workspace': event => {
		const {id, name, rank} = event.payload;
		const result = nodeRepo.createNode(nodes.workspace(id, name, rank));

		if (isFail(result)) {
			return materializeFail(
				result.message ?? 'Failed to add workspace',
				event,
			);
		}

		if (!isWorkspaceNode(result.value)) {
			return failed('Unexpected create node return value');
		}

		return succeeded('Added workspace', {
			action: event.action,
			result: result.value,
		});
	},

	'add.board': event => {
		const {id, name, parent: parentId, rank} = event.payload;
		const result = nodeRepo.createNode(nodes.board(id, name, parentId, rank));

		if (isFail(result)) {
			return materializeFail(result.message ?? 'Unable to create board', event);
		}

		if (!isBoardNode(result.value)) {
			return failed('Unexpected create node return value');
		}

		return succeeded('Added board', {
			action: event.action,
			result: result.value,
		});
	},

	'add.swimlane': event => {
		const {id, name, parent: parentId, rank} = event.payload;
		const result = nodeRepo.createNode(
			nodes.swimlane(id, name, parentId, rank),
		);

		if (isFail(result)) {
			return materializeFail(
				result.message ?? 'Unable to create swimlane',
				event,
			);
		}

		if (!isSwimlaneNode(result.value)) {
			return failed('Unexpected create node return value');
		}

		return succeeded('Added swimlane', {
			action: event.action,
			result: result.value,
		});
	},

	'add.issue': event => {
		const {id, name, parent: parentId, rank} = event.payload;
		const result = nodeRepo.createNode(nodes.ticket(id, name, parentId, rank));

		if (isFail(result)) {
			return materializeFail(result.message ?? 'Unable to create issue', event);
		}

		if (!isTicketNode(result.value)) {
			return failed('Unexpected create node return value');
		}

		return succeeded('Added issue', {
			action: event.action,
			result: result.value,
		});
	},

	'add.field': event => {
		const {id, name, parent: parentId, val: value, rank} = event.payload;

		const result = nodeRepo.createNode(
			nodes.field({
				id,
				name,
				parentNodeId: parentId,
				rank,
				props: {value},
				childRenderAxis: name.includes(FieldNames.DESCRIPTION)
					? 'vertical'
					: 'horizontal',
			}),
		);

		if (isFail(result)) {
			return materializeFail(
				result.message ?? `Unable to create field: ${name}`,
				event,
			);
		}

		if (!isFieldNode(result.value)) {
			return failed('Unexpected create node return value');
		}

		return succeeded('Added field', {
			action: event.action,
			result: result.value,
		});
	},

	'edit.title': event => {
		const {id, name} = event.payload;
		const node = nodeRepo.getNode(id);

		if (!node) {
			return materializeFail(`Unable to locate node with id ${id}`, event);
		}

		const result = nodeRepo.renameNode(id, name);
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

	'add.issue.tag': event => {
		const {id, tag} = event.payload;
		const result = nodeRepo.tag(id, tag);

		if (isFail(result)) {
			return materializeFail(result.message ?? 'Unable to tag issue', event);
		}

		return succeeded('Issue tagged', {
			action: event.action,
			result: {tag},
		});
	},

	'remove.issue.tag': event => {
		const {id, tag} = event.payload;
		const result = nodeRepo.untag(id, tag);

		if (isFail(result)) {
			return materializeFail(result.message ?? 'Unable to untag issue', event);
		}

		return succeeded('Issue untagged', {
			action: event.action,
			result: {tag},
		});
	},

	'add.issue.assignee': event => {
		const {id, assignee} = event.payload;
		const result = nodeRepo.assign(id, assignee);

		if (isFail(result)) {
			return materializeFail(result.message ?? 'Unable to assign issue', event);
		}

		return succeeded('Assigned successfully', {
			action: event.action,
			result: {assignee},
		});
	},

	'remove.issue.assignee': event => {
		const {id, assignee} = event.payload;
		const result = nodeRepo.unassign(id, assignee);

		if (isFail(result)) {
			return materializeFail(
				result.message ?? 'Unable to unassign issue',
				event,
			);
		}

		return succeeded('Issue unassigned', {
			action: event.action,
			result: {assignee},
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

	'rebalance.children': event => {
		const {parent, ranks} = event.payload;

		for (const [id, rank] of Object.entries(ranks)) {
			const node = nodeRepo.getNode(id);

			if (!node) return materializeFail(`Unable to locate node ${id}`, event);

			if (node.parentNodeId !== parent) {
				return materializeFail(`Node ${id} is not child of ${parent}`, event);
			}

			const result = nodeRepo.updateNode({
				...node,
				rank,
			});

			if (isFail(result)) {
				return materializeFail(
					result.message ?? 'Unable to rebalance child',
					event,
				);
			}
		}

		return succeeded('Rebalanced children', {
			action: event.action,
			result: {parent},
		});
	},
};

export function materialize<A extends EventAction>(
	event: AppEvent<A>,
	bypassLogging = false,
): MaterializeResult<A> {
	const result = materializeHandlers[event.action](event);
	if (isFail(result)) return result;

	const completionFail = completeMaterialization(event, bypassLogging);
	if (completionFail) return completionFail;

	return result;
}

export const materializeAll = <const T extends readonly AppEvent[]>(
	events: T,
): MaterializeResults<T> =>
	events.map(event => materialize(event)) as MaterializeResults<T>;
