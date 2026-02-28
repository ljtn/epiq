import {storageManager} from '../../storage/storage-manager.js';
import {appState} from '../../state/state.js';
import {nodeMapper} from '../../utils/node-mapper.js';
import {navigator} from '../default/navigation-action-utils.js';

function moveItemInArray<T>({
	array,
	from,
	to,
}: {
	array: T[];
	from: number;
	to: number;
}) {
	if (from < 0 || from >= array.length || to < 0 || to >= array.length) return;
	const [item] = array.splice(from, 1);
	if (item) array.splice(to, 0, item);
}

export function moveNodeToSiblingContainer(direction: -1 | 1) {
	const parentNode = appState.breadCrumb.at(-2);
	const currentNodeIndex = parentNode?.children.findIndex(
		({id}) => id === appState.currentNode.id,
	);
	if (currentNodeIndex === undefined || !parentNode) return;
	if (!Array.isArray(parentNode.children)) return;

	const currentNode = parentNode.children[currentNodeIndex];
	if (!currentNode) return;

	const targetNodeIndex = currentNodeIndex + direction;
	if (
		currentNodeIndex < 0 ||
		targetNodeIndex < 0 ||
		targetNodeIndex >= parentNode.children.length
	)
		return;

	const siblingNode = parentNode.children[targetNodeIndex];
	if (!siblingNode) return;

	const currentSelectionIndex = appState.selectedIndex;
	if (
		currentSelectionIndex < 0 ||
		currentSelectionIndex >= currentNode.children.length
	)
		return;

	// Build storageManager.move arguments
	const parentType = nodeMapper.contextToNodeTypeMap(currentNode.context);
	const fromParentId = currentNode.id;
	const fromIndex = currentSelectionIndex;
	const toParentId = siblingNode.id;
	const toIndex = siblingNode.children.length;

	const moveResult = storageManager.move({
		parentType,
		fromParentId,
		fromIndex,
		toParentId,
		toIndex,
	});

	// If disk save failed, don't mutate in-memory
	if (!moveResult || !moveResult.nodeId) {
		logger.error(
			'moveNodeToSiblingContainer: storageManager.move returned null or no nodeId',
		);
		return;
	}

	// Persist succeeded on disk — apply the same change in-memory
	const [moveNode] = currentNode.children.splice(currentSelectionIndex, 1);
	if (!moveNode) {
		// This is unexpected but handle defensively
		logger.warn(
			'moveNodeToSiblingContainer: moved node missing in-memory after disk move',
		);
		return;
	}

	siblingNode.children.push(moveNode as any);

	// Navigate to the sibling and select the moved node
	navigator.navigate({
		selectedIndex: siblingNode.children.length - 1,
		currentNode: siblingNode,
	});
}

export function moveChildWithinParent(direction: -1 | 1) {
	const from = appState.selectedIndex;
	const children = appState.currentNode?.children;
	const to = from + direction;
	if (to < 0 || to >= children.length) return;

	// parentType and id come from currentNode
	const {currentNode} = appState;
	const parentType = nodeMapper.contextToNodeTypeMap(currentNode.context);
	const parentId = appState.currentNode.id;

	// Call storageManager.move to reorder within the same parent
	const moveResult = storageManager.move({
		parentType,
		fromParentId: parentId,
		fromIndex: from,
		toParentId: parentId,
		toIndex: to,
	});

	if (!moveResult || !moveResult.nodeId) {
		logger.error(
			'moveChildWithinParent: storageManager.move returned null or no nodeId',
		);
		return;
	}

	// Disk update succeeded — update in-memory order and navigate
	moveItemInArray({
		array: children,
		from,
		to,
	});

	navigator.navigate({selectedIndex: to});
}
