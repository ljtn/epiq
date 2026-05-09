import {isFieldNode} from '../../model/context.model.js';
import {failed, Result, succeeded} from '../../model/result-types.js';
import {getOrderedChildren} from '../../repository/rank.js';
import {getRenderedChildren, getState} from '../../state/state.js';
import {navigationUtils} from './navigation-action-utils.js';

type NavigationAnchor = {
	currentNodeId: string;
	selectedNodeId: string | null;
	parentNodeId: string | null;
	selectedIndex: number;
};

const clampIndex = (index: number, length: number): number => {
	if (length <= 0) return -1;
	return Math.max(0, Math.min(index, length - 1));
};

export const captureNavigationAnchor = (): NavigationAnchor => {
	const {currentNode, selectedIndex, selectedNode} = getState();

	return {
		currentNodeId: currentNode.id,
		selectedNodeId: selectedNode?.id ?? null,
		parentNodeId: currentNode.id,
		selectedIndex,
	};
};

const isEnteredTextContainer = (nodeId: string): boolean => {
	const node = getState().nodes[nodeId];

	return (
		!!node &&
		!node.isDeleted &&
		isFieldNode(node) &&
		node.childRenderAxis === 'vertical'
	);
};

const tryNavigateIntoNode = (
	nodeId: string,
	selectedIndex: number,
): boolean => {
	const {nodes} = getState();
	const node = nodes[nodeId];

	if (!node || node.isDeleted) return false;

	const children = getRenderedChildren(node.id);

	navigationUtils.navigate({
		currentNode: node,
		selectedIndex: clampIndex(selectedIndex, children.length),
	});

	return true;
};

const tryNavigateToNode = (nodeId: string): boolean => {
	const {nodes} = getState();
	const selectedNode = nodes[nodeId];

	if (!selectedNode || selectedNode.isDeleted) return false;

	const parentId = selectedNode.parentNodeId;

	if (!parentId) {
		return tryNavigateIntoNode(selectedNode.id, 0);
	}

	const parent = nodes[parentId];
	if (!parent || parent.isDeleted) return false;

	const siblings = getOrderedChildren(parent.id);
	const selectedIndex = siblings.findIndex(
		child => child.id === selectedNode.id,
	);

	if (selectedIndex >= 0) {
		navigationUtils.navigate({
			currentNode: parent,
			selectedIndex,
		});

		return true;
	}

	return tryNavigateToNode(parent.id);
};

const tryNavigateToNodeOrAncestor = (nodeId: string): boolean => {
	const {nodes} = getState();

	let currentId: string | null | undefined = nodeId;
	const visited = new Set<string>();

	while (currentId && !visited.has(currentId)) {
		visited.add(currentId);

		if (tryNavigateToNode(currentId)) return true;

		currentId = nodes[currentId]?.parentNodeId;
	}

	return false;
};

const isLiveNode = (nodeId: string | null): boolean => {
	if (!nodeId) return false;

	const node = getState().nodes[nodeId];
	return !!node && !node.isDeleted;
};

export const restoreNavigationAnchor = (
	anchor: NavigationAnchor,
): Result<null> => {
	const {nodes, rootNodeId} = getState();

	if (
		isEnteredTextContainer(anchor.currentNodeId) &&
		tryNavigateIntoNode(anchor.currentNodeId, anchor.selectedIndex)
	) {
		return succeeded('Restored navigation inside text container', null);
	}

	if (
		isLiveNode(anchor.selectedNodeId) &&
		anchor.selectedNodeId &&
		tryNavigateToNodeOrAncestor(anchor.selectedNodeId)
	) {
		return succeeded('Restored navigation to selected node or ancestor', null);
	}

	if (tryNavigateIntoNode(anchor.currentNodeId, anchor.selectedIndex)) {
		return succeeded('Restored navigation to previous container', null);
	}

	if (
		anchor.parentNodeId &&
		tryNavigateIntoNode(anchor.parentNodeId, anchor.selectedIndex)
	) {
		return succeeded('Restored navigation to previous parent', null);
	}

	if (tryNavigateToNodeOrAncestor(anchor.currentNodeId)) {
		return succeeded(
			'Restored navigation to previous container or ancestor',
			null,
		);
	}

	const root = nodes[rootNodeId];

	if (!root || root.isDeleted) {
		return failed('Unable to restore navigation');
	}

	const rootChildren = getRenderedChildren(root.id);

	navigationUtils.navigate({
		currentNode: root,
		selectedIndex: clampIndex(anchor.selectedIndex, rootChildren.length),
	});

	return succeeded('Restored navigation to root', null);
};
