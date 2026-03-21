import {cmdResult, Result} from '../command-line/command-types.js';
import {Mode} from '../model/action-map.model.js';
import {
	AnyContext,
	isFieldListNode,
	NavNodeCtx,
} from '../model/context.model.js';
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

function normalizeListValue(value: string): string {
	return sanitizeInlineText(value).replace(/\s+/g, ' ').trim();
}

function collectFieldListValues(
	node: NavNode<AnyContext> | undefined,
	fieldName: string,
): string[] {
	if (!node) return [];

	const values: string[] = [];
	const seen = new Set<string>();

	const visit = (current: NavNode<AnyContext>) => {
		if (current.name === fieldName && isFieldListNode(current)) {
			for (const child of current.children ?? []) {
				const raw = String(child.props?.['value'] ?? child.name ?? '');
				const value = normalizeListValue(raw);
				const key = value.toLowerCase();

				if (value && !seen.has(key)) {
					seen.add(key);
					values.push(value);
				}
			}
		}

		for (const child of current.children ?? []) {
			visit(child);
		}
	};

	visit(node);
	return values.sort((a, b) => a.localeCompare(b));
}

export const nodeRepository = {
	getExistingTags(): string[] {
		const {rootNode} = getState();
		if (!rootNode) return [];
		return collectFieldListValues(rootNode, 'Tags');
	},

	getExistingAssignees(): string[] {
		const {rootNode} = getState();
		if (!rootNode) return [];
		return collectFieldListValues(rootNode, 'Assignees');
	},

	addTag(name: string): Result {
		const parent = this.findListItemParent('Tags');
		if (!parent) {
			logger.error(`Could not find node with name "${name}"`);
			return {result: cmdResult.Fail, message: 'Could not find parent to tag'};
		}
		if (!isFieldListNode(parent)) {
			logger.error(
				`Parent node context ${parent.context} for "${parent.name}" is not a list.`,
			);
			return {
				result: cmdResult.Fail,
				message: `Parent node context ${parent.context} for "${parent.name}" is not a list.`,
			};
		}

		if (parent.children.some(({props}) => props['value'] === name)) {
			logger.info('Cannot add duplicate tag');
			return {
				result: cmdResult.Fail,
				message: 'Cannot add duplicate tag',
			};
		}

		return this.addListItem(SEED_RESOURCES.tag, name, parent);
	},

	assignUser(name: string): Result {
		const parent = this.findListItemParent('Assignees');
		if (!parent) {
			logger.error(`Could not find node with name "${name}"`);
			return {result: cmdResult.Fail, message: ''};
		}
		if (!isFieldListNode(parent)) {
			logger.error(
				`Parent node context ${parent.context} for "${parent.name}" is not a list.`,
			);
			return {result: cmdResult.Fail, message: ''};
		}

		logger.info(
			name,
			parent.children.map(({props}) => props['value']),
		);
		if (parent.children.some(({props}) => props['value'] === name)) {
			logger.info('Cannot add duplicate assignee');
			return {
				result: cmdResult.Fail,
				message: 'Cannot add duplicate assignee',
			};
		}

		return this.addListItem(SEED_RESOURCES.assignee, name, parent);
	},

	findListItemParent(parentName: string) {
		const {currentNode, selectedIndex} = getState();
		const target = currentNode.children[selectedIndex];
		if (!target) {
			logger.error(`Missing target node`);
			return;
		}
		return findNodeInTree({name: parentName}, target, [])?.node;
	},

	addListItem(
		name: (typeof SEED_RESOURCES)[keyof typeof SEED_RESOURCES],
		valueRaw: string,
		parent: NavNode<AnyContext>,
	): Result {
		const value = sanitizeInlineText(valueRaw);
		if (!value) {
			logger.error('Unable to add list item without name');
			return {
				result: cmdResult.Fail,
				message: 'Unable to add list item without name',
			};
		}

		if (parent.context !== NavNodeCtx.FIELD_LIST) {
			logger.error('Field item can only be added inside a FIELD_LIST node');
			return {
				result: cmdResult.Fail,
				message: 'Field item can only be added inside a FIELD_LIST node',
			};
		}

		const itemValue = value || '';
		const diskNode = storage.createNode({
			parentId: parent.id,
			definition: {
				name,
				initialValue: itemValue,
				type: StorageNodeTypes.FIELD, // Perhaps parameterize
			},
		});

		if (!diskNode) {
			logger.error('Unable to add field item');
			return {
				result: cmdResult.Fail,
				message: 'Unable to add field item',
			};
		}

		// Now update its value resource
		storage.updateNodeValue(diskNode.id, itemValue);

		nodeRepository.appendChildToNode(parent.id, nodeMapper.toField(diskNode));

		return {
			result: cmdResult.Success,
		};
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

	appendChildToNodeAndSelect: <C extends NavNode<AnyContext>>(
		node: NavNode<AnyContext>,
		child: C,
	) =>
		updateState(old => {
			const result = replaceNodeInTree(node.id, old.rootNode, prev => ({
				...prev,
				children: [...(prev.children ?? []), child] as typeof prev.children,
			}));

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
				rootNode: result.root,
				currentNodeId: updatedNode.id,
				selectedIndex: (updatedNode.children?.length ?? 1) - 1,
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
