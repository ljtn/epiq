// What "a node's children" means, shared by derivation and rank resolution so
// the two can't drift. Inside a replay batch only the scan is correct.

import {isTicketNode, type AnyContext} from '../model/context.model.js';
import type {Filter} from '../model/app-state.model.js';
import type {NavNode} from '../model/navigation-node.model.js';
import {ticketMatchesFilter} from '../utils/filter.js';

// By code unit, not `localeCompare`: ranks are lowercase hex.
export const byRank = (
	left: NavNode<AnyContext>,
	right: NavNode<AnyContext>,
): number => (left.rank < right.rank ? -1 : left.rank > right.rank ? 1 : 0);

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

// The lists of these parents alone, in one pass over the nodes.
export const groupChildrenOfSome = (
	nodes: Record<string, NavNode<AnyContext>>,
	parentIds: ReadonlySet<string>,
): Record<string, NavNode<AnyContext>[]> => {
	const index: Record<string, NavNode<AnyContext>[]> = {};

	for (const node of Object.values(nodes)) {
		if (!node.parentNodeId || node.isDeleted) continue;
		if (!parentIds.has(node.parentNodeId)) continue;

		const siblings = index[node.parentNodeId];

		if (siblings) siblings.push(node);
		else index[node.parentNodeId] = [node];
	}

	for (const parentId of Object.keys(index)) {
		index[parentId]!.sort(byRank);
	}

	return index;
};
