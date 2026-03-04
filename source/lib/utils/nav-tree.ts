import {BreadCrumb} from '../model/app-state.model.js';
import {AnyContext} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';

export function replaceNodeInTree<T extends NavNode<AnyContext>>(
	targetId: string,
	root: T,
	replacer: (prev: NavNode<AnyContext>) => NavNode<AnyContext>,
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
		for (let i = 0; i < node.children.length; i++) {
			const child = node.children[i]!;
			const res = walk(child, nextPath);
			if (!res) continue;

			// We found it somewhere below; rebuild this node with updated child
			const nextChildren = node.children.slice();
			(nextChildren[i] as NavNode<AnyContext>) = res.rebuilt;

			// If the direct child we replaced is *this* child, then the host should be THIS rebuilt node
			// (not the old `node` reference).
			const rebuiltNode: NavNode<AnyContext> = {
				...node,
				children: nextChildren,
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

export const findNodeInTree = (
	nodeId: string,
	ctx: NavNode<AnyContext>,
	breadCrumb: BreadCrumb | [],
): {node: NavNode<AnyContext>; breadCrumb: BreadCrumb} | undefined => {
	const nextBreadCrumb = [...breadCrumb, ctx] as BreadCrumb;

	if (ctx.id === nodeId) {
		return {node: ctx, breadCrumb: nextBreadCrumb};
	}

	for (const child of ctx.children) {
		const res = findNodeInTree(nodeId, child, nextBreadCrumb);
		if (res) return res;
	}

	return undefined;
};
