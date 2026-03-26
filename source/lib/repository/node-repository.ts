import {
	failed,
	ReturnedResult,
	succeeded,
} from '../command-line/command-types.js';
import {Mode} from '../model/action-map.model.js';
import {
	AnyContext,
	isFieldListNode,
	NavNodeCtx,
} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {StorageNodeTypes} from '../model/storage-node.model.js';
import {BaseState, getState, patchState, updateState} from '../state/state.js';
import {SEED_RESOURCES} from '../storage/seed.js';
import {storage} from '../storage/storage.js';
import {filterMap} from '../utils/array.utils.js';
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

function normalizeListValue(value: string): string {
	return sanitizeInlineText(value).replace(/\s+/g, ' ').trim();
}

function collectFieldListValues(
	node: NavNode<AnyContext> | undefined,
	fieldName: string,
): string[] {
	if (!node) return [];
	const {nodes} = getState();

	const values: string[] = [];
	const seen = new Set<string>();
	const visit = (current: NavNode<AnyContext>) => {
		const children = filterMap(current.children, id => nodes[id]);
		if (current.title === fieldName && isFieldListNode(current)) {
			for (const child of children ?? []) {
				if (!child) continue;
				const raw = String(child.props?.['value'] ?? child.title ?? '');
				const value = normalizeListValue(raw);
				const key = value.toLowerCase();

				if (value && !seen.has(key)) {
					seen.add(key);
					values.push(value);
				}
			}
		}

		for (const child of children ?? []) {
			visit(child);
		}
	};

	visit(node);
	return values.sort((a, b) => a.localeCompare(b));
}

export const nodeRepository = {
	getExistingTags(): string[] {
		const {rootNodeId, nodes} = getState();
		const rootNode = nodes[rootNodeId];
		if (!rootNode) return [];
		return collectFieldListValues(rootNode, 'Tags');
	},

	getExistingAssignees(): string[] {
		const {rootNodeId, nodes} = getState();
		const rootNode = nodes[rootNodeId];
		if (!rootNode) return [];
		return collectFieldListValues(rootNode, 'Assignees');
	},

	addTag(name: string): ReturnedResult {
		const parent = this.findListItemParent('Tags');
		if (!parent) {
			logger.error(`Could not find node with name "${name}"`);
			return failed('Could not find parent to tag');
		}
		if (!isFieldListNode(parent)) {
			logger.error(
				`Parent node context ${parent.context} for "${parent.title}" is not a list.`,
			);
			return failed(
				`Parent node context ${parent.context} for "${parent.title}" is not a list.`,
			);
		}

		const {nodes} = getState();
		const children = filterMap(parent.children, id => nodes[id]);
		if (children.some(({props}) => props['value'] === name)) {
			logger.info('Cannot add duplicate tag');
			return failed('Cannot add duplicate tag');
		}

		return this.addListItem(SEED_RESOURCES.tag, name, parent);
	},

	assignUser(name: string): ReturnedResult {
		const parent = this.findListItemParent('Assignees');
		if (!parent) {
			logger.error(`Could not find node with name "${name}"`);
			return failed(`Could not find node with name "${name}"`);
		}
		if (!isFieldListNode(parent)) {
			logger.error(
				`Parent node context ${parent.context} for "${parent.title}" is not a list.`,
			);
			return failed('Parent node context is not a list');
		}

		const {nodes} = getState();
		const children = filterMap(parent.children, id => nodes[id]);

		if (children.some(({props}) => props['value'] === name)) {
			logger.info('Cannot add duplicate assignee');
			return failed('Cannot add duplicate assignee');
		}

		return this.addListItem(SEED_RESOURCES.assignee, name, parent);
	},

	findListItemParent(parentName: string): NavNode<AnyContext> | undefined {
		const {currentNode, selectedIndex, nodes} = getState();
		const targetId = currentNode.children[selectedIndex];
		if (!targetId) return;
		const target = nodes[targetId];
		if (!target) {
			logger.error(`Missing target node`);
			return;
		}
		return findNodeInTree({title: parentName}, target, [], nodes)?.node;
	},

	addListItem(
		name: (typeof SEED_RESOURCES)[keyof typeof SEED_RESOURCES],
		valueRaw: string,
		parent: NavNode<AnyContext>,
	): ReturnedResult {
		const value = sanitizeInlineText(valueRaw);
		if (!value) {
			logger.error('Unable to add list item without name');
			return failed('Unable to add list item without name');
		}

		if (parent.context !== NavNodeCtx.FIELD_LIST) {
			logger.error('Field item can only be added inside a FIELD_LIST node');
			return failed('Field item can only be added inside a FIELD_LIST node');
		}

		const itemValue = value || '';
		const diskNode = storage.createNode({
			parentId: parent.id,
			definition: {
				name,
				parentNodeId: parent.id,
				initialValue: itemValue,
				type: StorageNodeTypes.FIELD, // Perhaps parameterize
			},
		});

		if (!diskNode) {
			logger.error('Unable to add field item');
			return failed('Unable to add field item');
		}

		// Now update its value resource
		storage.updateNodeValue(diskNode.id, itemValue);

		nodeRepository.appendChildToNode(parent.id, nodeMapper.toField(diskNode));

		return succeeded('Added item', diskNode);
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

			const nextRoot = reorderAt(old.rootNodeId);

			const nextBreadCrumb = findBreadCrumb(nextRoot, parentId);
			if (!nextBreadCrumb) return old;

			return {
				...old,
				rootNodeId: nextRoot,
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
		const {currentNode, nodes, selectedIndex} = getState();

		if (!currentNode.parentNodeId) {
			logger.error('Missing parent node id');
			return {targetNodeId: currentNode.id, selectedIndex};
		}

		const parentNode = nodes[currentNode.parentNodeId];
		if (!parentNode) return null;

		const currentNodeIndex = parentNode.children.findIndex(
			id => id === currentNode.id,
		);

		const siblingNodeId = parentNode.children.at(currentNodeIndex + direction);
		if (!siblingNodeId) return null;

		const siblingNode = nodes[siblingNodeId];
		if (!currentNode || !siblingNode) return null;

		const fromIndex = selectedIndex;
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
			const root = old.rootNodeId;

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
				rootNodeId: nextRoot,
				currentNodeId: nextCurrent.id,
				selectedIndex: (nextCurrent.children?.length ?? 1) - 1,
			} satisfies BaseState;
		});

		return {
			targetNodeId: siblingNode.id,
			selectedIndex: siblingNode.children.length, // UI layer can clamp after refresh
		};
	},

	appendChildToNodeAndSelect: <C extends NavNode<AnyContext>>(
		node: NavNode<AnyContext>,
		child: C,
	) =>
		updateState(old => {
			const rootNode = old.nodes[old.rootNodeId];
			if (!rootNode) return old;

			const result = replaceNodeInTree(
				node.id,
				rootNode,
				prev => ({
					...prev,
					children: [...(prev.children ?? []), child] as typeof prev.children,
				}),
				old.nodes,
			);

			if (!result) {
				logger.error(
					'appendChildToNodeAndSelect: unable to replace node in tree',
				);
				return old;
			}

			const updatedNode = result.breadCrumb.at(-1);
			if (!updatedNode) {
				logger.error(
					'appendChildToNodeAndSelect: updated node not found in breadcrumb',
				);
				return old;
			}

			return {
				...old,
				rootNodeId: result.root.id,
				currentNodeId: updatedNode.id,
				selectedIndex: (updatedNode.children?.length ?? 1) - 1,
			} satisfies BaseState;
		}),

	updateNode(newNode: NavNode<AnyContext>) {
		const {nodes, rootNodeId} = getState();
		const rootNode = nodes[rootNodeId];
		if (!rootNode) return;
		const result = replaceNodeInTree(
			newNode.id,
			rootNode,
			() => newNode,
			nodes,
		);
		if (!result) return logger.error('Unable to replace node in tree');

		return updateState(state => {
			return {
				...state,
				rootNodeId: result.root.id,
			} satisfies BaseState;
		});
	},

	appendChildToNode<C extends NavNode<AnyContext>>(
		parentNodeId: string,
		child: C,
	) {
		updateState(old => {
			const rootNode = old.nodes[old.rootNodeId];
			if (!rootNode) return old;

			const result = replaceNodeInTree(
				parentNodeId,
				rootNode,
				prev => ({
					...prev,
					children: [...(prev.children ?? []), child] as typeof prev.children,
				}),
				old.nodes,
			);

			if (!result) {
				logger.error('appendChildToNode: unable to replace node in tree');
				return old;
			}

			return {
				...old,
				rootNodeId: result.root.id,
			} satisfies BaseState;
		});
	},

	deleteNode(parentNodeId: string, deleteNodeId: string): void {
		if (!storage.canDeleteNode(deleteNodeId)) {
			logger.info('Attempted to delete protected node');
			return;
		}

		storage.unlinkChild(parentNodeId, deleteNodeId);

		const {nodes, rootNodeId} = getState();
		const rootNode = nodes[rootNodeId];
		if (!rootNode) return;
		const newRootNode = removeNodeInTree(deleteNodeId, rootNode, nodes)?.root;

		if (!newRootNode) {
			logger.info('Unable to delete node due to failed remove operation');
			return;
		}

		const res = findNodeInTree({id: parentNodeId}, newRootNode, [], nodes);
		if (!res) return;
		const {node, breadCrumb} = res;
		// If parent has children, focus on first
		let selectedIndex = -1;
		if (node?.children.length) {
			// If parent has no children, focus on the parent
			selectedIndex = 0;
		}
		patchState({
			rootNodeId: newRootNode.id,
			currentNodeId: breadCrumb.at(-1)?.id,
			selectedIndex,
			mode: Mode.DEFAULT,
		});
	},
};
