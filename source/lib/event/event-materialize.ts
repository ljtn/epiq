import {logger} from '../../logger.js';
import {
	isBoardNode,
	isFieldNode,
	isSwimlaneNode,
	isTicketNode,
	isWorkspaceNode,
} from '../model/context.model.js';
import {
	failed,
	isFail,
	Result,
	ReturnFail,
	succeeded,
} from '../model/result-types.js';
import {FieldNames} from '../repository/fielNames.js';
import {nodeRepo} from '../repository/node-repo.js';
import {nodes} from '../state/node-builder.js';
import {
	getState,
	initWorkspaceState,
	isStateInitialized,
	updateState,
	withDeferredDerive,
} from '../state/state.js';
import {
	areVirtualNodesEnabled,
	materializeTicketVirtualNodes,
} from '../virtual-nodes/virtual-nodes.js';
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

/**
 * A precondition failure: the event lost a race, or names state this replay
 * never applied — the ordinary result of a merge, or of skipping an action
 * this build does not know. Replay skips these so it converges; failing the
 * whole boot instead means one concurrent edit can leave a board that never
 * opens again, for whoever's build understands the most.
 *
 * Still a failure, so a live write rejects it: there the precondition is the
 * answer the caller asked for.
 */
type ConvergenceFail = ReturnFail & {convergence: true};

const materializeSkip = <A extends AppEvent>(
	msg: string,
	event: A,
): ConvergenceFail => ({...materializeFail(msg, event), convergence: true});

export const isConvergenceFail = (result: Result): boolean =>
	isFail(result) && (result as Partial<ConvergenceFail>).convergence === true;

/**
 * Splits replay results into a log that is actually broken and events that
 * merely lost. Every replay path aborts on the first and skips the second.
 */
export const partitionMaterializeResults = (
	results: readonly Result[],
): {fatal: ReturnFail[]; skipped: ReturnFail[]} => {
	const failures = results.filter(isFail);

	return {
		fatal: failures.filter(failure => !isConvergenceFail(failure)),
		skipped: failures.filter(isConvergenceFail),
	};
};

export const logSkippedEvents = (skipped: readonly ReturnFail[]): void => {
	if (skipped.length === 0) return;

	logger.info(
		`Skipped ${
			skipped.length
		} event(s) that could not be applied to this state: ${skipped
			.map(failure => failure.message)
			.join('; ')}`,
	);
};

const refreshTicketVirtualNodes = (nodeId: string): ReturnFail | null => {
	const node = nodeRepo.getNode(nodeId);

	if (!node || !isTicketNode(node) || node.isDeleted) return null;

	const result = materializeTicketVirtualNodes(node);
	if (isFail(result)) return result;

	return null;
};

const refreshAffectedVirtualNodes = (nodeIds: string[]): ReturnFail | null => {
	if (!areVirtualNodesEnabled()) return null;

	for (const nodeId of nodeIds) {
		const result = refreshTicketVirtualNodes(nodeId);
		if (result) return result;

		const parentId = getState().nodes[nodeId]?.parentNodeId;
		if (!parentId) continue;

		const parentResult = refreshTicketVirtualNodes(parentId);
		if (parentResult) return parentResult;
	}

	return null;
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

export const getAffectedNodeIds = (event: AppEvent): string[] => {
	switch (event.action) {
		case 'add.issue.comment':
		case 'edit.issue.comment':
		case 'delete.issue.comment':
		case 'add.issue.attachment':
		case 'delete.issue.attachment':
			return [event.payload.issue];

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
		case 'set.issue.epic':
		case 'clear.issue.epic':
		case 'add.issue.assignee':
		case 'remove.issue.assignee':
			return [event.payload.id];

		case 'rebalance.children':
			return Object.keys(event.payload.ranks);

		// Registry entries, belonging to no node: nothing to append a log line to
		// and no virtual node to refresh.
		case 'create.tag':
		case 'tombstone.tag':
		case 'restore.tag':
		case 'create.epic':
		case 'create.contributor':
		case 'rename.contributor':
		case 'link.contributor.user':
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

const validateEventUser = (event: AppEvent): Result => {
	const id = event.userId;
	const name = event.userName;

	if (!id?.length || !name?.length) {
		return materializeFail('Invalid user ID format', event);
	}

	return succeeded('Valid user', null);
};

// A replay applies every event before anything reads the result, so the work
// that only the final state needs is collected here and done once at the end.
// Per event it was quadratic: each append copied the whole log, and a ticket's
// virtual fields were rebuilt once for every event that touched it.
type ReplayBatch = {
	appLog: AppEvent[];
	nodeLog: Map<string, AppEvent[]>;
	virtualNodeIds: Set<string>;
	genesisApplied: boolean;
};

let replayBatch: ReplayBatch | null = null;

const flushReplayBatch = (batch: ReplayBatch): ReturnFail | null => {
	for (const [nodeId, events] of batch.nodeLog) {
		const node = nodeRepo.getNode(nodeId);
		if (!node) continue;

		nodeRepo.updateNode({...node, log: [...(node.log ?? []), ...events]});
	}

	if (batch.appLog.length > 0) {
		updateState(s => ({...s, eventLog: [...s.eventLog, ...batch.appLog]}));
	}

	// After the logs, since a ticket's log is one of the fields these build.
	return refreshAffectedVirtualNodes([...batch.virtualNodeIds]);
};

const completeMaterialization = (
	event: AppEvent,
	bypassLogging: boolean,
): ReturnFail | null => {
	const userFail = validateEventUser(event);
	if (isFail(userFail)) return userFail;

	const affectedNodeIds = [...new Set(getAffectedNodeIds(event))];

	if (replayBatch) {
		for (const nodeId of affectedNodeIds) {
			if (!bypassLogging) {
				const events = replayBatch.nodeLog.get(nodeId);
				if (events) events.push(event);
				else replayBatch.nodeLog.set(nodeId, [event]);
			}

			if (areVirtualNodesEnabled()) {
				replayBatch.virtualNodeIds.add(nodeId);

				// The parent as it stands now, which a later move may change; the
				// flush refreshes the final one too.
				const parentId = getState().nodes[nodeId]?.parentNodeId;
				if (parentId) replayBatch.virtualNodeIds.add(parentId);
			}
		}

		if (!bypassLogging) replayBatch.appLog.push(event);

		return null;
	}

	if (!bypassLogging) {
		affectedNodeIds.forEach(nodeId => appendEventToNodeLog(nodeId, event));
		appendEventToAppLog(event);
	}

	const virtualNodeFail = refreshAffectedVirtualNodes(affectedNodeIds);
	if (virtualNodeFail) return virtualNodeFail;

	return null;
};

/**
 * The two ways a creation event can damage state rather than add to it.
 *
 * `createNode` writes into the node map unconditionally — it has to, since the
 * TUI rebuilds ephemeral nodes under fixed ids on every render — so a second
 * `add.*` naming a live id replaces that node's title, rank, parent,
 * description, tags, assignees and readonly flag. And a node that is its own
 * parent turns every ancestor walk into a loop.
 *
 * Neither is reachable from this build's writers; both are reachable from a
 * log, which is why they are convergence skips rather than failures. First
 * writer wins, which is the only choice that converges.
 */
const refuseUncreatableNode = (
	id: string,
	parentId: string | undefined,
	event: AppEvent,
): ConvergenceFail | null => {
	if (nodeRepo.getNode(id)) {
		return materializeSkip(`a node with id ${id} already exists`, event);
	}

	if (parentId === id) {
		return materializeSkip('a node cannot be its own parent', event);
	}

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
			return materializeSkip(
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

		const uncreatable = refuseUncreatableNode(id, undefined, event);
		if (uncreatable) return uncreatable;

		const result = nodeRepo.createNode(nodes.workspace(id, name, rank));

		if (isFail(result)) {
			return materializeSkip(
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

		const uncreatable = refuseUncreatableNode(id, parentId, event);
		if (uncreatable) return uncreatable;

		const result = nodeRepo.createNode(nodes.board(id, name, parentId, rank));

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to create board', event);
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

		const uncreatable = refuseUncreatableNode(id, parentId, event);
		if (uncreatable) return uncreatable;

		const result = nodeRepo.createNode(
			nodes.swimlane(id, name, parentId, rank),
		);

		if (isFail(result)) {
			return materializeSkip(
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

		const uncreatable = refuseUncreatableNode(id, parentId, event);
		if (uncreatable) return uncreatable;

		const result = nodeRepo.createNode(nodes.ticket(id, name, parentId, rank));

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to create issue', event);
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

		const uncreatable = refuseUncreatableNode(id, parentId, event);
		if (uncreatable) return uncreatable;

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
			return materializeSkip(
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
			return materializeSkip(`Unable to locate node with id ${id}`, event);
		}

		const result = nodeRepo.renameNode(id, name);
		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to edit title', event);
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
			return materializeSkip(result.message ?? 'Unable to delete node', event);
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
			return materializeSkip(result.message ?? 'Unable to create tag', event);
		}

		return succeeded('Tag added', {
			action: event.action,
			result: result.value,
		});
	},

	'tombstone.tag': event => {
		const {id} = event.payload;
		const result = nodeRepo.tombstoneTag(id);

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to delete tag', event);
		}

		return succeeded('Tag tombstoned', {
			action: event.action,
			result: result.value,
		});
	},

	'restore.tag': event => {
		const {id, name} = event.payload;
		const result = nodeRepo.restoreTag(id, name);

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to restore tag', event);
		}

		return succeeded('Tag restored', {
			action: event.action,
			result: result.value,
		});
	},

	'create.contributor': event => {
		const {id, name} = event.payload;
		const result = nodeRepo.createContributor({id, name});

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Unable to create contributor',
				event,
			);
		}

		return succeeded('Contributor created', {
			action: event.action,
			result: result.value,
		});
	},

	'rename.contributor': event => {
		const {id, name} = event.payload;
		const result = nodeRepo.renameContributor(id, name);

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Unable to rename contributor',
				event,
			);
		}

		return succeeded('Contributor renamed', {
			action: event.action,
			result: result.value,
		});
	},

	'tombstone.contributor': event => {
		const {id} = event.payload;
		const result = nodeRepo.tombstoneContributor(id);

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Unable to remove contributor',
				event,
			);
		}

		return succeeded('Contributor tombstoned', {
			action: event.action,
			result: result.value,
		});
	},

	'restore.contributor': event => {
		const {id, name} = event.payload;
		const result = nodeRepo.restoreContributor(id, name);

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Unable to restore contributor',
				event,
			);
		}

		return succeeded('Contributor restored', {
			action: event.action,
			result: result.value,
		});
	},

	'create.epic': event => {
		const {id, name} = event.payload;
		const result = nodeRepo.createEpic({id, name});

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to create epic', event);
		}

		return succeeded('Epic created', {
			action: event.action,
			result: result.value,
		});
	},

	'set.issue.epic': event => {
		const {id, epic} = event.payload;
		const result = nodeRepo.setEpic(id, epic);

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? "Unable to set the issue's epic",
				event,
			);
		}

		return succeeded('Issue epic set', {
			action: event.action,
			result: {epic},
		});
	},

	'clear.issue.epic': event => {
		const {id} = event.payload;
		const result = nodeRepo.clearEpic(id);

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? "Unable to clear the issue's epic",
				event,
			);
		}

		return succeeded('Issue epic cleared', {
			action: event.action,
			result: {id},
		});
	},

	'add.issue.tag': event => {
		const {id, tag} = event.payload;
		const result = nodeRepo.tag(id, tag);

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to tag issue', event);
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
			return materializeSkip(result.message ?? 'Unable to untag issue', event);
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
			return materializeSkip(result.message ?? 'Unable to assign issue', event);
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
			return materializeSkip(
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
			return materializeSkip(result.message ?? 'Failed to move node', event);
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
			return materializeSkip(
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

		if (!node) return materializeSkip('Unable to locate issue', event);
		if (!isTicketNode(node))
			return materializeSkip('Can only close issues', event);

		const closeSwimlane = nodeRepo.getNode(CLOSED_SWIMLANE_ID);
		if (!closeSwimlane) {
			return materializeSkip('Unable to locate target swimlane', event);
		}

		if (parentId !== closeSwimlane.id) {
			return materializeSkip('Close target must be closed swimlane', event);
		}

		const result = nodeRepo.moveNodeToRank({
			id,
			parentId,
			rank,
		});

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to close issue', event);
		}

		return succeeded('Issue closed', {
			action: event.action,
			result: {id},
		});
	},

	'reopen.issue': event => {
		const {id, parent: parentId, rank} = event.payload;
		const node = nodeRepo.getNode(id);

		if (!node) return materializeSkip('Unable to locate issue', event);
		if (!isTicketNode(node))
			return materializeSkip('Can only reopen issues', event);

		const closeSwimlane = nodeRepo.getNode(CLOSED_SWIMLANE_ID);
		if (!closeSwimlane) {
			return materializeSkip('Unable to locate closed swimlane', event);
		}

		if (parentId === closeSwimlane.id) {
			return materializeSkip('Cannot reopen issue into closed swimlane', event);
		}

		const previousParent = nodeRepo.getNode(parentId);
		if (!previousParent) {
			return materializeSkip('Reopen parent no longer exists', event);
		}

		const result = nodeRepo.moveNodeToRank({
			id,
			parentId,
			rank,
		});

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to reopen issue', event);
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
			return materializeSkip(result.message ?? 'Unable to lock node', event);
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

			if (!node) return materializeSkip(`Unable to locate node ${id}`, event);

			if (node.parentNodeId !== parent) {
				return materializeSkip(`Node ${id} is not child of ${parent}`, event);
			}

			const result = nodeRepo.updateNode({
				...node,
				rank,
			});

			if (isFail(result)) {
				return materializeSkip(
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

	'add.issue.comment': event => {
		const {id, issue, author, md} = event.payload;

		const result = nodeRepo.createComment({
			id,
			issue,
			authorId: author,
			authorName: nodeRepo.getContributor(author)?.name ?? 'Unknown',
			md,
			deleted: false,
		});

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to add comment', event);
		}

		return succeeded('Comment added', {
			action: event.action,
			result: {id, issue, author, md},
		});
	},

	'edit.issue.comment': event => {
		const {id, issue, md} = event.payload;

		const existing = nodeRepo.getComment(id);
		if (!existing) return materializeSkip('Unable to locate comment', event);
		if (existing.issue !== issue) {
			return materializeSkip('Comment does not belong to issue', event);
		}

		const result = nodeRepo.editComment(id, md);

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to edit comment', event);
		}

		return succeeded('Comment edited', {
			action: event.action,
			result: {id, issue, md},
		});
	},

	'delete.issue.comment': event => {
		const {id, issue} = event.payload;

		const existing = nodeRepo.getComment(id);
		if (!existing) return materializeSkip('Unable to locate comment', event);
		if (existing.issue !== issue) {
			return materializeSkip('Comment does not belong to issue', event);
		}

		const result = nodeRepo.deleteComment(id);

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Unable to delete comment',
				event,
			);
		}

		return succeeded('Comment deleted', {
			action: event.action,
			result: {id, issue},
		});
	},

	'add.issue.attachment': event => {
		const {id, issue, hash, ext, name, bytes} = event.payload;

		const result = nodeRepo.createAttachment({
			id,
			issue,
			hash,
			ext,
			name,
			bytes,
			deleted: false,
		});

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Unable to add attachment',
				event,
			);
		}

		return succeeded('Attachment added', {
			action: event.action,
			result: {id, issue, hash},
		});
	},

	'delete.issue.attachment': event => {
		const {id, issue} = event.payload;

		const existing = nodeRepo.getAttachment(id);
		if (!existing) return materializeSkip('Unable to locate attachment', event);
		if (existing.issue !== issue) {
			return materializeSkip('Attachment does not belong to issue', event);
		}

		const result = nodeRepo.deleteAttachment(id);

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Unable to delete attachment',
				event,
			);
		}

		return succeeded('Attachment deleted', {
			action: event.action,
			result: {id, issue},
		});
	},
	'link.contributor.user': event => {
		const {contributor} = event.payload;

		const result = nodeRepo.linkUserId({
			contributorId: contributor,
			userId: event.userId,
		});

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Unable to link contributor',
				event,
			);
		}

		return succeeded('Contributor linked to user', {
			action: event.action,
			result: {
				contributor,
				userId: event.userId,
			},
		});
	},
};

export function materialize<A extends EventAction>(
	event: AppEvent<A>,
	bypassLogging = false,
): MaterializeResult<A> {
	// Unknown actions are filtered at load time; this guards any other path
	// so a foreign event yields a failed Result instead of a crash.
	const handler = materializeHandlers[event.action];
	if (!handler) {
		return failed(
			`Unknown event action "${event.action}", likely created by a newer epiq version. Evt id: ${event.id}`,
		);
	}

	// Anything ordered ahead of `init.workspace` — a forged root, or an id that
	// does not decode and so sorts before every real ULID — reaches its handler
	// with no state to read. Most handlers land on `getState()`, which throws,
	// and an uncaught throw here takes the whole process down on load rather
	// than skipping one event. Replay is total: this is a precondition the
	// replay never met, which is exactly what `materializeSkip` is for.
	if (!isStateInitialized() && event.action !== 'init.workspace') {
		return materializeSkip(
			`${event.action} arrived before the workspace was initialized`,
			event,
		);
	}

	// Genesis initializes state from scratch, so a second one part-way through a
	// replay discards everything applied before it. A forged root carrying a lone
	// `init.workspace` satisfies the root filter, and a high ULID anchors it
	// after real history — one such line would empty the board on every clone
	// that pulled it. Only the replay's first genesis counts; the guard is per
	// batch because state stays initialized between replays.
	if (event.action === 'init.workspace' && replayBatch) {
		if (replayBatch.genesisApplied) {
			return materializeSkip('the workspace is already initialized', event);
		}

		replayBatch.genesisApplied = true;
	}

	// Last line of defence. Payloads are validated on load and every
	// precondition below is a `materializeSkip`, but a handler this build gets
	// wrong must still not stop the board: a throw here escapes every `isFail`
	// on the boot path, and the log that caused it is append-only and already
	// in every clone. Converging on a skipped event beats never opening again.
	let result: MaterializeResult<A>;
	try {
		result = handler(event);
	} catch (error) {
		return materializeSkip(
			`threw while materializing (${
				error instanceof Error ? error.message : String(error)
			})`,
			event,
		);
	}

	if (isFail(result)) return result;

	const completionFail = completeMaterialization(event, bypassLogging);
	if (completionFail) return completionFail;

	return result;
}

// One derive for the whole replay rather than one per event. Deriving rebuilds
// an index over every node, so per-event it made replay quadratic — 1.4k events
// took 905ms, and each doubling of the log quadrupled it.
export const materializeAll = <const T extends readonly AppEvent[]>(
	events: T,
): MaterializeResults<T> => {
	const result = withDeferredDerive(() => {
		// Nested calls join the outer batch, matching withDeferredDerive.
		const owned = replayBatch === null;
		if (owned) {
			replayBatch = {
				appLog: [],
				nodeLog: new Map(),
				virtualNodeIds: new Set(),
				genesisApplied: false,
			};
		}

		try {
			const results = events.map(event =>
				materialize(event),
			) as MaterializeResults<T>;

			if (owned && replayBatch) {
				const flushFail = flushReplayBatch(replayBatch);
				if (flushFail) return events.map(() => flushFail) as typeof results;
			}

			return results;
		} finally {
			if (owned) replayBatch = null;
		}
	});

	// A failed derive leaves the events applied to the base state either way;
	// the caller reads the per-event results to decide what to do about it.
	return isFail(result)
		? (events.map(() => failed(result.message)) as MaterializeResults<T>)
		: result.value;
};
