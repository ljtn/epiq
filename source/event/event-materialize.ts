import {navigationUtils} from '../lib/actions/default/navigation-action-utils.js';
import {failed, isFail, succeeded} from '../lib/command-line/command-types.js';
import {isTicketNode} from '../lib/model/context.model.js';
import {nodes} from '../lib/state/node-builder.js';
import {
	getRenderedChildren,
	getState,
	initWorkspaceState,
} from '../lib/state/state.js';
import {nodeRepo} from '../repository/node-repo.js';
import {AppEvent, EventAction, MaterializeResult} from './event.model.js';
import {resolveReopenParentFromLog} from './log-utils.js';
import {CLOSED_SWIMLANE_ID} from './static-ids.js';

type MaterializeHandlers = {
	[A in EventAction]: (event: AppEvent<A>) => MaterializeResult<A>;
};

export type MaterializeResults<T extends readonly AppEvent[]> = {
	[K in keyof T]: T[K] extends AppEvent<infer A> ? MaterializeResult<A> : never;
};

const materializeFail = <A extends EventAction>(
	msg: string,
	action: A,
): MaterializeResult<A> =>
	failed(`${action.split('.').join(' ') + ' failed, ' + msg.toLowerCase()}`);

const materializeHandlers: MaterializeHandlers = {
	'init.workspace': ({action, payload}) => {
		const {id, name} = payload;
		const workspace = nodes.workspace(id, name);
		initWorkspaceState(workspace);

		const result = nodeRepo.createNodeAtPosition(workspace);
		if (isFail(result)) {
			return materializeFail(
				result.message ?? 'Failed to initialize workspace',
				action,
			);
		}

		return succeeded('Workspace initialized', {
			action,
			result: result.data,
		});
	},

	'add.workspace': ({action, payload}) => {
		const {id, name} = payload;
		const workspace = nodes.workspace(id, name);

		const result = nodeRepo.createNodeAtPosition(workspace);
		if (isFail(result)) {
			return materializeFail(
				result.message ?? 'Failed to add workspace',
				action,
			);
		}

		return succeeded('Added workspace', {
			action,
			result: result.data,
		});
	},

	'add.board': ({action, payload}) => {
		const {id, name, parent: parentId} = payload;
		const result = nodeRepo.createNodeAtPosition(
			nodes.board(id, name, parentId),
		);

		if (isFail(result)) {
			return materializeFail(
				result.message ?? 'Unable to create board',
				action,
			);
		}

		return succeeded('Added board', {
			action,
			result: result.data,
		});
	},

	'add.swimlane': ({action, payload}) => {
		const {id, name, parent: parentId} = payload;
		const result = nodeRepo.createNodeAtPosition(
			nodes.swimlane(id, name, parentId),
		);

		if (isFail(result)) {
			return materializeFail(
				result.message ?? 'Unable to create swimlane',
				action,
			);
		}

		return succeeded('Added swimlane', {
			action,
			result: result.data,
		});
	},

	'add.issue': ({action, payload}) => {
		const {id, name, parent: parentId} = payload;
		const result = nodeRepo.createNodeAtPosition(
			nodes.ticket(id, name, parentId),
		);

		if (isFail(result)) {
			return materializeFail(
				result.message ?? 'Unable to create issue',
				action,
			);
		}

		return succeeded('Added issue', {
			action,
			result: result.data,
		});
	},

	'add.field': ({action, payload}) => {
		const {id, name, parent: parentId, val: value} = payload;
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
				action,
			);
		}

		return succeeded('Added field', {
			action,
			result: result.data,
		});
	},

	'edit.title': ({action, payload}) => {
		const {id, name: value} = payload;
		const node = nodeRepo.getNode(id);
		if (!node) return materializeFail('Unable to locate node', action);

		const result = nodeRepo.renameNode(id, value);
		if (isFail(result)) {
			return materializeFail(result.message ?? 'Unable to edit title', action);
		}

		return succeeded('Edited title', {
			action,
			result: result.data,
		});
	},

	'delete.node': ({action, payload}) => {
		const {id} = payload;
		const result = nodeRepo.tombstoneNode(id);

		if (isFail(result)) {
			return materializeFail(result.message ?? 'Unable to delete node', action);
		}

		return succeeded('Deleted node', {
			action,
			result: result.data,
		});
	},

	'create.tag': ({action, payload}) => {
		const {id, name} = payload;
		const result = nodeRepo.createTag({id, name});

		if (isFail(result)) {
			return materializeFail(result.message ?? 'Unable to create tag', action);
		}

		return succeeded('Tag added', {
			action,
			result: result.data,
		});
	},

	'create.contributor': ({action, payload}) => {
		const {id, name} = payload;
		const result = nodeRepo.createContributor({id, name});

		if (isFail(result)) {
			return materializeFail(
				result.message ?? 'Unable to create contributor',
				action,
			);
		}

		return succeeded('Contributor created', {
			action,
			result: result.data,
		});
	},

	'tag.issue': ({action, payload}) => {
		const {id, target: targetId, tagId} = payload;
		const tagged = nodeRepo.tag(targetId, tagId, id);

		if (isFail(tagged)) {
			return materializeFail(tagged.message ?? 'Unable to tag issue', action);
		}

		return succeeded('Issue tagged', {
			action,
			result: tagged.data,
		});
	},

	'assign.issue': ({action, payload}) => {
		const {id, contributor: contributorId, target: targetId} = payload;
		const result = nodeRepo.assign(targetId, contributorId, id);

		if (isFail(result)) {
			return materializeFail(
				result.message ?? 'Unable to assign issue',
				action,
			);
		}

		return succeeded('Assigned successfully', {
			action,
			result: result.data,
		});
	},

	'move.node': ({action, payload}) => {
		const {id, parent: parentId, pos: position} = payload;
		const result = nodeRepo.moveNode({id, parentId, position});

		if (isFail(result)) {
			return materializeFail(result.message ?? 'Failed to move node', action);
		}

		return succeeded('Moved node', {
			action,
			result: result.data,
		});
	},

	'edit.description': ({action, payload}) => {
		const {id, md} = payload;
		const result = nodeRepo.editValue(id, md);

		if (isFail(result)) {
			return materializeFail(
				result.message ?? 'Unable to edit description',
				action,
			);
		}

		return succeeded('Set node value', {
			action,
			result: result.data,
		});
	},

	'close.issue': ({action, payload}) => {
		const {id} = payload;
		const node = nodeRepo.getNode(id);
		if (!node) return materializeFail('Unable to locate issue', action);
		if (!isTicketNode(node))
			return materializeFail('Can only close issues', action);

		const closeSwimlane = nodeRepo.getNode(CLOSED_SWIMLANE_ID);
		if (!closeSwimlane) {
			return materializeFail('Unable to locate target swimlane', action);
		}

		const isClosed = closeSwimlane.id === node.parentNodeId;
		if (isClosed) {
			return materializeFail('Cannot close closed issue', action);
		}

		const result = nodeRepo.moveNode({
			id,
			parentId: closeSwimlane.id,
		});

		if (isFail(result)) {
			return materializeFail(result.message ?? 'Unable to close issue', action);
		}

		return succeeded('Issue closed', {
			action,
			result: result.data,
		});
	},

	'reopen.issue': ({action, payload}) => {
		const {id} = payload;
		const node = nodeRepo.getNode(id);

		if (!node) return materializeFail('Unable to locate issue', action);
		if (!isTicketNode(node))
			return materializeFail('Can only reopen issues', action);

		const closeSwimlane = nodeRepo.getNode(CLOSED_SWIMLANE_ID);
		if (!closeSwimlane) {
			return materializeFail('Unable to locate closed swimlane', action);
		}

		const isClosed = node.parentNodeId === closeSwimlane.id;
		if (!isClosed) return materializeFail('Issue is not closed', action);

		const previousParentId = resolveReopenParentFromLog(node);
		if (!previousParentId) {
			return materializeFail(
				'Unable to resolve previous parent from issue history',
				action,
			);
		}

		if (previousParentId === closeSwimlane.id) {
			return materializeFail(
				'Previous parent resolves to closed swimlane',
				action,
			);
		}

		const previousParent = nodeRepo.getNode(previousParentId);
		if (!previousParent) {
			return materializeFail('Previous parent no longer exists', action);
		}

		const result = nodeRepo.moveNode({
			id,
			parentId: previousParentId,
		});

		if (isFail(result)) {
			return materializeFail(
				result.message ?? 'Unable to reopen issue',
				action,
			);
		}

		return succeeded('Issue reopened', {
			action,
			result: result.data,
		});
	},

	'lock.node': ({action, payload}) => {
		const {id} = payload;
		const result = nodeRepo.lockNode(id);

		if (isFail(result)) {
			return materializeFail(result.message ?? 'Unable to lock node', action);
		}

		return succeeded('Node locked', {
			action,
			result: result.data,
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
		case 'assign.issue':
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
	const handler = materializeHandlers[event.action] as (
		event: AppEvent<A>,
	) => MaterializeResult<A>;

	const result = handler(event);
	if (isFail(result)) return result;

	if (!bypassLogging) {
		const affectedNodeIds = [...new Set(getAffectedNodeIds(event))];
		for (const nodeId of affectedNodeIds) {
			appendEventToNodeLog(nodeId, event);
		}
	}

	const [id, name] = event.userId.split('.');
	if (!id?.length || !name?.length) {
		return materializeFail('Invalid user ID format', event.action);
	}
	nodeRepo.createContributor({name, id});

	return result;
}

export const materializeAll = <const T extends readonly AppEvent[]>(
	events: T,
): MaterializeResults<T> =>
	events.map(event => materialize(event)) as MaterializeResults<T>;
