import {BreadCrumb} from '../model/app-state.model.js';
import {AnyContext} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {filterMap} from './array.utils.js';

export function replaceNodeInTree<T extends NavNode<AnyContext>>(
	targetId: string,
	root: T,
	replacer: (prev: NavNode<AnyContext>) => NavNode<AnyContext>,
	nodes: Record<string, NavNode<AnyContext>>,
):
	| {
			root: T; // overall tree root (possibly new)
			host: NavNode<AnyContext> | null; // the parent/container of the replaced node (null if target was the root)
			replaced: NavNode<AnyContext>; // the new node that was inserted
			breadCrumb: NavNode<AnyContext>[]; // path to replaced node (includes replaced node)
	  }
	| undefined {
	const walk = (
		node: NavNode<AnyContext>,
		path: NavNode<AnyContext>[],
	):
		| {
				rebuilt: NavNode<AnyContext>;
				host: NavNode<AnyContext> | null;
				replaced: NavNode<AnyContext>;
				breadCrumb: NavNode<AnyContext>[];
		  }
		| undefined => {
		const nextPath = [...path, node];

		// replacing the current node (no host in this frame; host is the previous node in the path)
		if (node.id === targetId) {
			const replaced = replacer(node);
			const host = path.length ? path[path.length - 1]! : null;
			return {
				rebuilt: replaced,
				host,
				replaced,
				breadCrumb: [...path, replaced],
			};
		}

		// otherwise search children
		const children = filterMap(node.children, id => nodes[id]);
		for (let i = 0; i < children.length; i++) {
			const child = children[i]!;
			const res = walk(child, nextPath);
			if (!res) continue;

			// We found it somewhere below; rebuild this node with updated child
			const nextChildren = children.slice();
			(nextChildren[i] as NavNode<AnyContext>) = res.rebuilt;

			// If the direct child we replaced is *this* child, then the host should be THIS rebuilt node
			// (not the old `node` reference).
			const rebuiltNode: NavNode<AnyContext> = {
				...node,
				children: nextChildren.map(({id}) => id),
			};

			const host = child.id === targetId ? rebuiltNode : res.host;

			return {
				rebuilt: rebuiltNode,
				host,
				replaced: res.replaced,
				breadCrumb: res.breadCrumb,
			};
		}

		return undefined;
	};

	const res = walk(root, []);
	if (!res) return undefined;

	return {
		root: res.rebuilt as T,
		host: res.host,
		replaced: res.replaced,
		breadCrumb: res.breadCrumb,
	};
}

/**
 * Remove a node by id with structural sharing.
 *
 * Notes:
 * - If you remove the root itself, this returns undefined (caller decides what to do).
 * - `removedBreadCrumb` is the path to the removed node (includes the removed node),
 *   which is useful for selecting a sensible fallback (parent/prev sibling/next sibling).
 */
export function removeNodeInTree<T extends NavNode<AnyContext>>(
	targetId: string,
	root: T,
	nodes: Record<string, NavNode<AnyContext>>,
):
	| {
			root: T; // overall tree root (new)
			host: NavNode<AnyContext>; // parent/container the node was removed from (rebuilt reference)
			removed: NavNode<AnyContext>; // the node that was removed
			removedIndex: number; // index it had in host.children
			removedBreadCrumb: NavNode<AnyContext>[]; // path to removed node (includes removed node)
	  }
	| undefined {
	const walk = (
		node: NavNode<AnyContext>,
		path: NavNode<AnyContext>[],
	):
		| {
				rebuilt: NavNode<AnyContext>;
				host: NavNode<AnyContext>;
				removed: NavNode<AnyContext>;
				removedIndex: number;
				removedBreadCrumb: NavNode<AnyContext>[];
		  }
		| undefined => {
		const nextPath = [...path, node];

		// Root removal: let caller decide (we can't return a different root safely)
		if (node.id === targetId) return undefined;

		const children = filterMap(node.children, id => nodes[id]);
		for (let i = 0; i < children.length; i++) {
			const child = children[i]!;
			if (child.id === targetId) {
				const nextChildren = children.slice();
				const removed = nextChildren.splice(i, 1)[0]!;
				const rebuiltHost: NavNode<AnyContext> = {
					...node,
					children: nextChildren.map(({id}) => id),
				};

				return {
					rebuilt: rebuiltHost,
					host: rebuiltHost,
					removed,
					removedIndex: i,
					removedBreadCrumb: [...nextPath, removed],
				};
			}

			const res = walk(child, nextPath);
			if (!res) continue;

			// Rebuild this node with the rebuilt subtree
			const nextChildren = children.slice();
			const childIdx = i;
			(nextChildren[childIdx] as NavNode<AnyContext>) = res.rebuilt;

			const rebuiltNode: NavNode<AnyContext> = {
				...node,
				children: nextChildren.map(({id}) => id),
			};

			// If removal happened inside the direct child we just rebuilt,
			// the host reference must be the rebuilt version coming from `res`,
			// not this node.
			return {
				rebuilt: rebuiltNode,
				host: res.host,
				removed: res.removed,
				removedIndex: res.removedIndex,
				removedBreadCrumb: res.removedBreadCrumb,
			};
		}

		return undefined;
	};

	const res = walk(root, []);
	if (!res) return undefined;

	return {
		root: res.rebuilt as T,
		host: res.host,
		removed: res.removed,
		removedIndex: res.removedIndex,
		removedBreadCrumb: res.removedBreadCrumb,
	};
}

export const findNodeInTree = (
	matcher: Partial<NavNode<AnyContext>>,
	ctx: NavNode<AnyContext>,
	breadCrumb: BreadCrumb | [],
	nodes: Record<string, NavNode<AnyContext>>,
): {node: NavNode<AnyContext>; breadCrumb: BreadCrumb} | undefined => {
	const nextBreadCrumb = [...breadCrumb, ctx] as BreadCrumb;

	const match = Object.entries(matcher).find(
		([key, value]) => ctx[key as keyof NavNode<AnyContext>] === value,
	);
	if (match) {
		return {node: ctx, breadCrumb: nextBreadCrumb};
	}

	const children = filterMap(ctx.children, id => nodes[id]);
	for (const child of children) {
		const res = findNodeInTree(matcher, child, nextBreadCrumb, nodes);
		if (res) return res;
	}

	return undefined;
};
