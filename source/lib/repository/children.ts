// What "a node's children" means, shared by derivation and rank resolution so
// the two can't drift. Inside a replay batch only the scan is correct.

import {isTicketNode, type AnyContext} from '../model/context.model.js';
import type {Filter} from '../model/app-state.model.js';
import type {NavNode} from '../model/navigation-node.model.js';
import {ticketMatchesFilter} from '../utils/filter.js';

const byCodeUnit = (left: string, right: string): number =>
	left < right ? -1 : left > right ? 1 : 0;

// By code unit, not `localeCompare`: ranks are lowercase hex. Total: concurrent
// inserts can share a rank, and ids decide between them.
export const byRank = (
	left: NavNode<AnyContext>,
	right: NavNode<AnyContext>,
): number => byCodeUnit(left.rank, right.rank) || byCodeUnit(left.id, right.id);

// Deleted nodes are tombstoned, never removed, so skip them.
const isChildOf = (
	node: NavNode<AnyContext> | undefined,
	parentId: string,
): node is NavNode<AnyContext> =>
	!!node && !node.isDeleted && node.parentNodeId === parentId;

export const orderChildrenOf = (
	nodes: Record<string, NavNode<AnyContext>>,
	parentId: string,
): NavNode<AnyContext>[] =>
	Object.values(nodes)
		.filter((node): node is NavNode<AnyContext> => isChildOf(node, parentId))
		.sort(byRank);

// Every parent's children at once. `filters` narrows tickets only, never lanes.
export const groupChildrenByParent = (
	nodes: Record<string, NavNode<AnyContext>>,
	filters: Filter[],
): Record<string, NavNode<AnyContext>[]> => {
	const index: Record<string, NavNode<AnyContext>[]> = {};

	for (const node of Object.values(nodes)) {
		if (
			isTicketNode(node) &&
			filters.length > 0 &&
			!filters.every(filter => ticketMatchesFilter(node, filter))
		) {
			continue;
		}

		if (!node.parentNodeId || node.isDeleted) continue;

		const siblings = index[node.parentNodeId];

		if (siblings) siblings.push(node);
		else index[node.parentNodeId] = [node];
	}

	for (const parentId of Object.keys(index)) {
		index[parentId]!.sort(byRank);
	}

	return index;
};

// The lists of these parents alone, from their lists before and the nodes
// written since, which are the only ones that can have joined one.
export const regroupChildren = (
	nodes: Record<string, NavNode<AnyContext>>,
	previous: Record<string, NavNode<AnyContext>[]>,
	parentIds: ReadonlySet<string>,
	written: ReadonlySet<string>,
): Record<string, NavNode<AnyContext>[]> => {
	const candidates = new Map<string, Set<string>>();
	const of = (parentId: string) => {
		let ids = candidates.get(parentId);
		if (!ids) candidates.set(parentId, (ids = new Set()));
		return ids;
	};

	for (const parentId of parentIds) {
		for (const child of previous[parentId] ?? []) of(parentId).add(child.id);
	}
	for (const id of written) {
		const parentId = nodes[id]?.parentNodeId;
		if (parentId && parentIds.has(parentId)) of(parentId).add(id);
	}

	const index: Record<string, NavNode<AnyContext>[]> = {};
	for (const [parentId, ids] of candidates) {
		const children = [...ids]
			.map(id => nodes[id])
			.filter((node): node is NavNode<AnyContext> => isChildOf(node, parentId))
			.sort(byRank);
		if (children.length > 0) index[parentId] = children;
	}

	return index;
};
