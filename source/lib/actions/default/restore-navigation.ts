import {isFieldNode} from '../../model/context.model.js';
import {failed, Result, succeeded} from '../../model/result-types.js';
import {getOrderedChildren} from '../../repository/rank.js';
import {getRenderedChildren, getState} from '../../state/state.js';
import {navigationUtils} from './navigation-action-utils.js';

type NavigationAnchor = {
	currentNodeId: string;
	selectedNodeId: string | null;
	selectedIndex: number;
};

const clampIndex = (index: number, length: number): number => {
	if (length <= 0) return -1;
	return Math.max(0, Math.min(index, length - 1));
};

export const captureNavigationAnchor = (): NavigationAnchor => {
	const {currentNode, selectedIndex, selectedNode} = getState();

	const anchor = {
		currentNodeId: currentNode.id,
		selectedNodeId: selectedNode?.id ?? null,
		selectedIndex,
	};

	logger.info('[navigation] captured navigation anchor', anchor);

	return anchor;
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

	logger.info('[navigation] tryNavigateIntoNode:start', {
		nodeId,
		selectedIndex,
	});

	if (!node) {
		logger.info('[navigation] cannot enter missing node', {nodeId});
		return false;
	}

	if (node.isDeleted) {
		logger.info('[navigation] cannot enter deleted node', {nodeId});
		return false;
	}

	navigationUtils.navigate({
		currentNode: node,
		selectedIndex,
	});

	logger.info('[navigation] navigated into node', {
		nodeId,
		selectedIndex,
	});

	return true;
};

const tryNavigateToNode = (nodeId: string): boolean => {
	const {nodes} = getState();

	logger.info('[navigation] tryNavigateToNode:start', {
		nodeId,
	});

	const selectedNode = nodes[nodeId];

	if (!selectedNode) {
		logger.info('[navigation] node missing', {nodeId});
		return false;
	}

	if (selectedNode.isDeleted) {
		logger.info('[navigation] node deleted', {nodeId});
		return false;
	}

	const parentId = selectedNode.parentNodeId;

	logger.info('[navigation] resolved node', {
		nodeId,
		parentId,
	});

	if (!parentId) {
		const children = getRenderedChildren(selectedNode.id);

		logger.info('[navigation] navigating directly into top-level node', {
			nodeId,
			childCount: children.length,
		});

		navigationUtils.navigate({
			currentNode: selectedNode,
			selectedIndex: clampIndex(0, children.length),
		});

		return true;
	}

	const parent = nodes[parentId];

	if (!parent) {
		logger.info('[navigation] parent missing', {
			nodeId,
			parentId,
		});

		return false;
	}

	if (parent.isDeleted) {
		logger.info('[navigation] parent deleted', {
			nodeId,
			parentId,
		});

		return false;
	}

	const siblings = getOrderedChildren(parent.id);

	logger.info('[navigation] resolved siblings', {
		nodeId,
		parentId,
		siblingCount: siblings.length,
	});

	const selectedIndex = siblings.findIndex(
		child => child.id === selectedNode.id,
	);

	logger.info('[navigation] sibling lookup result', {
		nodeId,
		parentId,
		selectedIndex,
	});

	if (selectedIndex >= 0) {
		logger.info('[navigation] navigating to node', {
			nodeId,
			parentId,
			selectedIndex,
		});

		navigationUtils.navigate({
			currentNode: parent,
			selectedIndex,
		});

		return true;
	}

	logger.info(
		'[navigation] node not selectable in parent, retrying with parent',
		{
			nodeId,
			parentId,
		},
	);

	return tryNavigateToNode(parent.id);
};

const tryNavigateToNodeOrAncestor = (nodeId: string): boolean => {
	const {nodes} = getState();

	logger.info('[navigation] tryNavigateToNodeOrAncestor:start', {
		nodeId,
	});

	let currentId: string | null | undefined = nodeId;
	const visited = new Set<string>();

	while (currentId && !visited.has(currentId)) {
		logger.info('[navigation] trying node or ancestor', {
			currentId,
		});

		visited.add(currentId);

		if (tryNavigateToNode(currentId)) {
			logger.info('[navigation] navigation restored', {
				currentId,
			});

			return true;
		}

		logger.info(
			'[navigation] moving to parent',
			currentId + ' ' + nodes[currentId]?.parentNodeId,
		);

		currentId = nodes[currentId]?.parentNodeId;
	}

	logger.info('[navigation] unable to restore via ancestor traversal', {
		startNodeId: nodeId,
		visited: [...visited],
	});

	return false;
};

export const restoreNavigationAnchor = (
	anchor: NavigationAnchor,
): Result<null> => {
	const {nodes, rootNodeId} = getState();

	logger.info('[navigation] restoreNavigationAnchor:start', anchor);

	// If the user was inside a vertical field, such as a log/description text view,
	// restore that entered container directly. Its rows are UI-only, not nodes.
	if (
		isEnteredTextContainer(anchor.currentNodeId) &&
		tryNavigateIntoNode(anchor.currentNodeId, anchor.selectedIndex)
	) {
		return succeeded('Restored navigation inside text container', null);
	}

	if (
		anchor.selectedNodeId &&
		tryNavigateToNodeOrAncestor(anchor.selectedNodeId)
	) {
		logger.info(
			'[navigation] restored navigation to selected node or ancestor',
			{
				selectedNodeId: anchor.selectedNodeId,
			},
		);

		return succeeded('Restored navigation to selected node or ancestor', null);
	}

	if (tryNavigateToNodeOrAncestor(anchor.currentNodeId)) {
		logger.info(
			'[navigation] restored navigation to previous container or ancestor',
			{
				currentNodeId: anchor.currentNodeId,
			},
		);

		return succeeded(
			'Restored navigation to previous container or ancestor',
			null,
		);
	}

	const root = nodes[rootNodeId];

	if (!root || root.isDeleted) {
		logger.info('[navigation] failed to restore navigation', {
			rootNodeId,
			rootExists: !!root,
			rootDeleted: root?.isDeleted,
		});

		return failed('Unable to restore navigation');
	}

	const rootChildren = getRenderedChildren(root.id);

	logger.info('[navigation] restoring navigation to root', {
		rootNodeId,
		rootChildCount: rootChildren.length,
		selectedIndex: anchor.selectedIndex,
	});

	navigationUtils.navigate({
		currentNode: root,
		selectedIndex: clampIndex(anchor.selectedIndex, rootChildren.length),
	});

	logger.info('[navigation] restoreNavigationAnchor:done');

	return succeeded('Restored navigation to root', null);
};
