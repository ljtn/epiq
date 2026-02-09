import {NavigationTree} from '../../model/navigation-tree.model.js';
import {appState} from '../../state/state.js';
import {navigationUtils} from '../default/navigation-action-utils.js';

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

function moveNodeToSiblingContainer(direction: -1 | 1) {
	const currentNode = appState.breadCrumb.at(-1);
	const parentNode = appState.breadCrumb.at(-2);
	if (!currentNode || !parentNode) return;

	if (!Array.isArray(parentNode.children)) return;

	const currentNodeIndex = parentNode.children.findIndex(
		x => x.id === currentNode.id,
	);
	const targetNodeIndex = currentNodeIndex + direction;
	if (
		currentNodeIndex < 0 ||
		targetNodeIndex < 0 ||
		targetNodeIndex >= parentNode.children.length
	)
		return;

	const siblingNode = parentNode.children[targetNodeIndex];
	if (!siblingNode) return;

	if (!Array.isArray(currentNode.children)) return;
	if (!Array.isArray(siblingNode.children)) siblingNode.children = []; // normalize empty container

	const currentSelectionIndex = appState.selectedIndex;
	if (
		currentSelectionIndex < 0 ||
		currentSelectionIndex >= currentNode.children.length
	)
		return;

	const [moveNode] = currentNode.children.splice(currentSelectionIndex, 1);
	if (!moveNode) return;

	siblingNode.children.push(moveNode as NavigationTree);

	navigationUtils.navigate({
		selectedIndex: siblingNode.children.length - 1,
		currentNode: siblingNode,
	});
}

export const moveChildToNextParent = () => {
	moveNodeToSiblingContainer(1);
};
export const moveChildToPreviousParent = () => {
	moveNodeToSiblingContainer(-1);
};

function moveChildWithinParent(direction: -1 | 1) {
	const from = appState.selectedIndex;
	const to = from + direction;
	if (to < 0 || to >= appState.currentNode.children.length) return;
	moveItemInArray({
		array: appState.currentNode.children,
		from,
		to,
	});
	navigationUtils.navigate({selectedIndex: to});
}

export const moveChildPreviousWithinParent = () => {
	moveChildWithinParent(-1);
};

export const moveChildNextWithinParent = () => {
	moveChildWithinParent(1);
};
