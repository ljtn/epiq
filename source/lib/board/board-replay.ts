import {isTicketNode} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {AnyContext} from '../model/context.model.js';
import {isFail, ReturnFail} from '../model/result-types.js';
import {nodeRepo} from '../repository/node-repo.js';
import {
	getState,
	isStateInitialized,
	updateState,
	withDeferredDerive,
} from '../state/state.js';
import {
	areVirtualNodesEnabled,
	materializeTicketVirtualNodes,
} from '../virtual-nodes/virtual-nodes.js';
import {ReplayHooks} from '../event/event-catalog.js';
import {AppEvent, AppEventMap} from './board-events.model.js';
import {forgetReplayed} from './board-replayed.js';
import {foldHistory} from './node-history.js';

// What the board keeps beside its state as events apply: each node's own log,
// the app-wide log, and the virtual fields a ticket derives from both.

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

// Only a ticket's history is ever shown, so only a ticket keeps where it sits.
const positionsFor = (
	node: NavNode<AnyContext>,
	positions: number[],
): number[] | null => (isTicketNode(node) ? positions : null);

const appendEventToNodeLog = (
	nodeId: string,
	event: AppEvent,
	position: number,
): void => {
	const node = nodeRepo.getNode(nodeId);
	if (!node) return;

	nodeRepo.updateNode({
		...node,
		log: [...(node.log ?? []), event],
		history: foldHistory(
			node.history,
			nodeId,
			[event],
			positionsFor(node, [position]),
		),
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
		case 'add.swimlane.rule':
		case 'remove.swimlane.rule':
		case 'add.issue.goal':
		case 'remove.issue.goal':
		case 'add.issue.assignee':
		case 'remove.issue.assignee':
			return [event.payload.id];

		case 'rebalance.children':
			return Object.keys(event.payload.ranks);

		case 'create.tag':
		case 'tombstone.tag':
		case 'restore.tag':
		case 'create.goal':
		case 'rename.goal':
		case 'edit.goal.description':
		case 'tombstone.goal':
		case 'create.contributor':
		case 'rename.contributor':
		case 'link.contributor.user':
		case 'link.contributor.email':
		case 'unlink.contributor.email':
		case 'connect.repo':
		case 'edit.repo':
		case 'disconnect.repo':
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

// A replay applies every event before anything reads the result, so the work
// that only the final state needs is collected here and done once at the end.
// Per event it was quadratic: each append copied the whole log, and a ticket's
// virtual fields were rebuilt once for every event that touched it.
type ReplayBatch = {
	appLog: AppEvent[];
	// Each node's events, and each one's place in `appLog`.
	nodeLog: Map<string, {events: AppEvent[]; offsets: number[]}>;
	virtualNodeIds: Set<string>;
};

let replayBatch: ReplayBatch | null = null;

const flushReplayBatch = (batch: ReplayBatch): ReturnFail | null => {
	// Where the batch's own log starts in the app-wide one, appended below.
	const base = getState().eventLog.length;

	for (const [nodeId, {events, offsets}] of batch.nodeLog) {
		const node = nodeRepo.getNode(nodeId);
		if (!node) continue;

		nodeRepo.updateNode({
			...node,
			log: [...(node.log ?? []), ...events],
			history: foldHistory(
				node.history,
				nodeId,
				events,
				positionsFor(
					node,
					offsets.map(offset => base + offset),
				),
			),
		});
	}

	if (batch.appLog.length > 0) {
		updateState(s => ({...s, eventLog: [...s.eventLog, ...batch.appLog]}));
	}

	// After the logs, since a ticket's log is one of the fields these build.
	return refreshAffectedVirtualNodes([...batch.virtualNodeIds]);
};

export const boardReplayHooks: ReplayHooks<AppEventMap> = {
	// Called, not referenced: the state module and this one import each other
	// through the board log, so at load time the binding may not be there yet.
	isInitialized: () => isStateInitialized(),

	// One derivation for the whole batch. Deriving rebuilds an index over
	// every node, so per event it made replay quadratic.
	batch: fn => withDeferredDerive(fn),

	afterApply(event, {batched, bypassLogging}) {
		// The state now holds what no log does; the next reload must replay it all.
		if (bypassLogging) forgetReplayed();

		const affectedNodeIds = [...new Set(getAffectedNodeIds(event))];

		if (batched) {
			replayBatch ??= {
				appLog: [],
				nodeLog: new Map(),
				virtualNodeIds: new Set(),
			};

			for (const nodeId of affectedNodeIds) {
				// Only a node there now, as applied one at a time: one created later in
				// the batch must not gain what came before it.
				if (!bypassLogging && nodeRepo.getNode(nodeId)) {
					// Its place in the batch's log, which it is pushed onto below.
					const offset = replayBatch.appLog.length;
					const held = replayBatch.nodeLog.get(nodeId);
					if (held) {
						held.events.push(event);
						held.offsets.push(offset);
					} else {
						replayBatch.nodeLog.set(nodeId, {
							events: [event],
							offsets: [offset],
						});
					}
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
			// The place it takes in the app-wide log, appended just after.
			const position = getState().eventLog.length;
			affectedNodeIds.forEach(nodeId =>
				appendEventToNodeLog(nodeId, event, position),
			);
			appendEventToAppLog(event);
		}

		return refreshAffectedVirtualNodes(affectedNodeIds);
	},

	flush() {
		if (!replayBatch) return null;

		const batch = replayBatch;
		replayBatch = null;

		return flushReplayBatch(batch);
	},
};
