import {Mode} from '../model/action-map.model.js';
import {AnyContext, NavNodeCtx} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {StorageNodeTypes} from '../model/storage-node.model.js';
import {BaseState, getState, patchState, updateState} from '../state/state.js';
import {SEED_RESOURCES, storage} from '../storage/storage.js';
import {
	findNodeInTree,
	removeNodeInTree,
	replaceNodeInTree,
} from '../utils/nav-tree.js';
import {nodeMapper} from '../utils/node-mapper.js';
import {sanitizeInlineText} from '../utils/string.utils.js';

function moveItemInArray<T>({
	array,
	from,
	to,
}: {
	array: readonly T[];
	from: number;
	to: number;
}): readonly T[] {
	const length = array.length;

	if (from < 0 || from >= length || to < 0 || to >= length || from === to) {
		return array;
	}

	const result = array.slice();
	const item = result[from]!;
	result.splice(from, 1);
	result.splice(to, 0, item);
	return result;
}

function findBreadCrumb(
	node: any,
	targetId: string,
	path: any[] = [],
): any[] | undefined {
	const nextPath = [...path, node];
	if (node.id === targetId) return nextPath;
	for (const child of node.children ?? []) {
		const found = findBreadCrumb(child, targetId, nextPath);
		if (found) return found;
	}
	return;
}

export const nodeRepository = {
	addTag(name: string) {
		const value = sanitizeInlineText(name);
		if (!value) {
			logger.error('Unable to add empty tag');
			return;
		}

		const {currentNode} = getState();
		const result = findNodeInTree({name: 'Tags'}, currentNode, []);
		if (!result) {
			logger.error('Could not find tags node');
			return;
		}

		this.addListItem(value, result.node);
	},

	addListItem: async (value: string, parent = getState().currentNode) => {
		if (parent.context !== NavNodeCtx.FIELD_LIST) {
			logger.error('Field item can only be added inside a FIELD_LIST node');
			return;
		}

		const itemValue = value || '';
		const diskNode = storage.createNode({
			parentId: parent.id,
			definition: {
				name: SEED_RESOURCES.tag,
				initialValue: itemValue,
				type: StorageNodeTypes.FIELD, // Perhaps parameterize
			},
		});

		if (!diskNode) {
			logger.error('Unable to add field item');
			return;
		}

		// Now update its value resource
		storage.updateNodeValue(diskNode.id, itemValue);

		return nodeRepository.appendChildToNode(
			parent.id,
			nodeMapper.toField(diskNode),
		);
	},

	/**
	 * Moves selected child within the current parent (reorder).
	 * Returns the next selectedIndex (the "to" index) if moved, otherwise null.
	 */
	moveChildWithinParent(direction: -1 | 1): number | null {
		const state = getState();

		const from = state.selectedIndex;
		const children = state.currentNode.children;
		const to = from + direction;

		if (from < 0 || to < 0 || to >= children.length) return null;

		const parentId = state.currentNode.id;

		const moveResult = storage.move({
			fromParentId: parentId,
			fromIndex: from,
			toParentId: parentId,
			toIndex: to,
		});

		if (!moveResult?.nodeId) {
			logger.error(
				'moveChildWithinParent: storageManager.move returned null or no nodeId',
			);
			return null;
		}

		updateState(old => {
			const reorderAt = (node: any): any => {
				if (!node?.children?.length) return node;

				const nextChildren = node.children.map(reorderAt);

				if (node.id === parentId) {
					const moved = moveItemInArray({array: nextChildren, from, to});
					return {...node, children: moved};
				}

				const changed = nextChildren.some(
					(c: any, i: number) => c !== node.children[i],
				);
				return changed ? {...node, children: nextChildren} : node;
			};

			const nextRoot = reorderAt(old.rootNode);

			const nextBreadCrumb = findBreadCrumb(nextRoot, parentId);
			if (!nextBreadCrumb) return old;

			return {
				...old,
				rootNode: nextRoot,
				currentNodeId: nextBreadCrumb.at(-1)!.id,
				selectedIndex: to,
			} satisfies BaseState;
		});

		return to;
	},

	/**
	 * Moves selected child from the current node into the sibling container (next/prev sibling),
	 * appending to the sibling's end.
	 *
	 * Returns the next navigation target (parentId + selectedIndex) if moved, otherwise null.
	 */
	moveNodeToSiblingContainer(
		direction: -1 | 1,
	): {targetNodeId: string; selectedIndex: number} | null {
		const state = getState();

		const parentNode = state.breadCrumb.at(-2);
		if (!parentNode) return null;

		const currentNodeIndex = parentNode.children.findIndex(
			({id}) => id === state.currentNode.id,
		);
		if (currentNodeIndex < 0) return null;

		const currentNode = parentNode.children[currentNodeIndex];
		const siblingNode = parentNode.children.at(currentNodeIndex + direction);
		if (!currentNode || !siblingNode) return null;

		const fromIndex = state.selectedIndex;
		if (fromIndex < 0 || fromIndex >= currentNode.children.length) return null;

		const moveResult = storage.move({
			fromParentId: currentNode.id,
			fromIndex,
			toParentId: siblingNode.id,
			toIndex: siblingNode.children.length,
		});

		if (!moveResult?.nodeId) {
			logger.error(
				'moveNodeToSiblingContainer: storageManager.move returned null or no nodeId',
			);
			return null;
		}

		updateState(old => {
			const root = old.rootNode;

			const fromParentId = currentNode.id;
			const toParentId = siblingNode.id;

			const patchTree = (node: any): any => {
				if (!node?.children?.length) return node;

				const nextChildren = node.children.map(patchTree);

				// Only rebuild at the "parentNode" level
				if (node.id !== parentNode.id) {
					const changed = nextChildren.some(
						(c: any, i: number) => c !== node.children[i],
					);
					return changed ? {...node, children: nextChildren} : node;
				}

				const fromParent = nextChildren.find((c: any) => c.id === fromParentId);
				const toParent = nextChildren.find((c: any) => c.id === toParentId);
				if (!fromParent || !toParent) return {...node, children: nextChildren};

				const moving = fromParent.children[fromIndex];
				if (!moving) return {...node, children: nextChildren};

				const nextFromKids = fromParent.children.filter(
					(_: any, i: number) => i !== fromIndex,
				);
				const nextToKids = [...toParent.children, moving];

				const nextChildren2 = nextChildren.map((c: any) => {
					if (c.id === fromParentId) return {...c, children: nextFromKids};
					if (c.id === toParentId) return {...c, children: nextToKids};
					return c;
				});

				return {...node, children: nextChildren2};
			};

			const nextRoot = patchTree(root);

			const nextBreadCrumb = findBreadCrumb(nextRoot, siblingNode.id);
			if (!nextBreadCrumb) return old;

			const nextCurrent = nextBreadCrumb.at(-1)!;

			return {
				...old,
				rootNode: nextRoot,
				currentNodeId: nextCurrent.id,
				selectedIndex: (nextCurrent.children?.length ?? 1) - 1,
			} satisfies BaseState;
		});

		return {
			targetNodeId: siblingNode.id,
			selectedIndex: siblingNode.children.length, // UI layer can clamp after refresh
		};
	},

	appendChildToCurrentNodeAndSelect: <C extends NavNode<AnyContext>>(
		child: C,
	) =>
		updateState(old => {
			const currentId = old.currentNode.id;

			const result = replaceNodeInTree(currentId, old.rootNode, prev => {
				return {
					...prev,
					children: [...(prev.children ?? []), child] as typeof prev.children,
				};
			});

			if (!result) {
				logger.error(
					'appendChildToCurrentNodeAndSelect: unable to replace node in tree',
				);
				return old;
			}

			const nextCurrent = result.breadCrumb.at(-1)!;
			const nextSelectedIndex = (nextCurrent.children?.length ?? 1) - 1;

			return {
				...old,
				rootNode: result.root,
				currentNodeId: nextCurrent.id,
				selectedIndex: nextSelectedIndex,
			} satisfies BaseState;
		}),

	updateNode(newNode: NavNode<AnyContext>) {
		const result = replaceNodeInTree(
			newNode.id,
			getState().rootNode,
			() => newNode,
		);
		if (!result) return logger.error('Unable to replace node in tree');

		return updateState(state => {
			return {
				...state,
				rootNode: result.root,
			} satisfies BaseState;
		});
	},

	appendChildToNode<C extends NavNode<AnyContext>>(
		parentNodeId: string,
		child: C,
	) {
		updateState(old => {
			const result = replaceNodeInTree(parentNodeId, old.rootNode, prev => ({
				...prev,
				children: [...(prev.children ?? []), child] as typeof prev.children,
			}));

			if (!result) {
				logger.error('appendChildToNode: unable to replace node in tree');
				return old;
			}

			return {
				...old,
				rootNode: result.root,
			} satisfies BaseState;
		});
	},

	deleteNode(parentNodeId: string, deleteNodeId: string): void {
		if (!storage.canDeleteNode(deleteNodeId)) {
			logger.info('Attempted to delete protected node');
			return;
		}

		storage.unlinkChild(parentNodeId, deleteNodeId);
		const rootNode = removeNodeInTree(deleteNodeId, getState().rootNode)?.root;
		if (!rootNode) {
			logger.info('Unable to delete node due to failed remove operation');
			return;
		}

		const res = findNodeInTree({id: parentNodeId}, rootNode, []);
		if (!res) return;
		const {node, breadCrumb} = res;
		// If parent has children, focus on first
		let selectedIndex = -1;
		if (node?.children.length) {
			// If parent has no children, focus on the parent
			selectedIndex = 0;
		}
		patchState({
			rootNode: breadCrumb[0],
			currentNodeId: breadCrumb.at(-1)?.id,
			selectedIndex,
			mode: Mode.DEFAULT,
		});
	},
};
