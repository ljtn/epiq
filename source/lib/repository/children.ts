// What "a node's children" means, said once.
//
// Two callers need it and used to say it separately: the state's derivation
// groups every node by parent so a board can be drawn, and rank resolution asks
// for one parent's children so a new ticket can be placed after them. Two
// spellings of one rule is two things to keep in step, and the rule is the part
// that must not drift — a board ordered one way and a rank resolved against
// another is a ticket that lands in the wrong place.
//
// They still run differently, and for a reason: a replay batch holds the
// derivation back deliberately, so inside one there is no current index to read
// and the scan is the only correct answer. What is shared is what the answer
// means, not how it is reached.

import {isTicketNode, type AnyContext} from '../model/context.model.js';
import type {Filter} from '../model/app-state.model.js';
import type {NavNode} from '../model/navigation-node.model.js';
import {ticketMatchesFilter} from '../utils/filter.js';

// Lexicographic by code unit, which is what a rank is built to be compared
// as. Not `localeCompare`: collation is locale-dependent and an order of
// magnitude slower, and a rank is lowercase hex, where the two agree.
export const byRank = (
	left: NavNode<AnyContext>,
	right: NavNode<AnyContext>,
): number => (left.rank < right.rank ? -1 : left.rank > right.rank ? 1 : 0);

// A deleted node is not a child: it keeps its id and its parent forever —
// tombstoned, never removed — so every reader has to skip it rather than
// expect it gone.
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

// Every parent's children at once, which is what a whole board needs.
//
// `filters` narrows tickets only: a swimlane is not a thing a filter hides, and
// dropping one would take its children off the board with it.
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

// The lists of these parents alone, in one pass over the nodes: what a
// write's derivation needs, since a write touches a ticket, its lane and at
// most the lane it left. One pass whatever their number, so a batch that
// touched every parent costs what grouping the whole board costs, not more.
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
