import {AnyContext} from '../../model/context.model.js';
import {NavNode} from '../../model/navigation-node.model.js';
import {getState, patchState, updateState} from '../../state/state.js';

export const appendChildId = <T extends AnyContext>(
	parent: NavNode<T>,
	childId: string,
): NavNode<T> => ({
	...parent,
	children: [...parent.children, childId],
});

export const nodeRepo = {
	createNode(node: NavNode<AnyContext>) {
		updateState(s => ({
			...s,
			nodes: {
				...s.nodes,
				[node.id]: node,
			},
		}));

		if (node.parentNodeId) this.appendChildToNode(node.parentNodeId, node);

		return node;
	},

	createNodes(nodes: NavNode<AnyContext>[]) {
		updateState(s => ({
			...s,
			nodes: {
				...s.nodes,
				...Object.fromEntries(nodes.map(node => [node.id, node])),
			},
		}));

		return nodes;
	},

	updateNode(node: NavNode<AnyContext>) {
		updateState(s => ({
			...s,
			nodes: {
				...s.nodes,
				[node.id]: node,
			},
			currentNodeId: s.currentNode.id === node.id ? s.currentNode.id : node.id, // BIG question mark here ??
		}));

		return node;
	},

	appendChildToNode(parentId: string, child: NavNode<AnyContext>) {
		const {nodes} = getState();
		const parent = this.getNode(parentId);
		if (!parent) {
			logger.error(
				'Unable to add child node to undefined parent with id:',
				parentId,
			);
			return;
		}
		const nextParent = appendChildId(parent, child.id);

		patchState({
			nodes: {
				...nodes,
				[parentId]: nextParent,
				[child.id]: child,
			},
		});

		return child;
	},

	// addListItem(_nameId: string, value: string, parent: NavNode<AnyContext>) {
	// 	const item = nodeBuilder.field(value, parent.id);
	// 	return this.appendChildToNodeAndSelect(parent, item);
	// },

	getNode<T extends AnyContext>(id: string) {
		return getState().nodes[id] as NavNode<T> | undefined;
	},
};
