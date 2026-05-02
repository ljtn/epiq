import {failed, Result, succeeded} from '../../model/result-types.js';
import {getRenderedChildren, getState} from '../../state/state.js';
import {navigationUtils} from './navigation-action-utils.js';

type NavigationAnchor = {
	currentNodeId: string;
	selectedNodeId: string | null;
	parentNodeId: string | null;
	selectedIndex: number;
};

export const captureNavigationAnchor = (): NavigationAnchor => {
	const {currentNode, selectedIndex} = getState();
	const selectedNode = getRenderedChildren(currentNode.id)[selectedIndex];

	return {
		currentNodeId: currentNode.id,
		selectedNodeId: selectedNode?.id ?? null,
		parentNodeId: selectedNode?.parentNodeId ?? null,
		selectedIndex,
	};
};

const clampIndex = (index: number, length: number): number =>
	Math.max(0, Math.min(index, Math.max(0, length - 1)));
export const restoreNavigationAnchor = (
	anchor: NavigationAnchor,
): Result<null> => {
	const {nodes} = getState();
	const currentNode = nodes[anchor.currentNodeId];

	// 1. Same container + same selected node.
	if (currentNode && !currentNode.isDeleted && anchor.selectedNodeId) {
		const children = getRenderedChildren(currentNode.id);
		const selectedIndex = children.findIndex(
			child => child.id === anchor.selectedNodeId,
		);

		if (selectedIndex >= 0) {
			navigationUtils.navigate({currentNode, selectedIndex});
			return succeeded('Restored navigation', null);
		}
	}

	// 2. Selected node still exists, but moved to another parent.
	if (anchor.selectedNodeId) {
		const selectedNode = nodes[anchor.selectedNodeId];

		if (selectedNode && !selectedNode.isDeleted && selectedNode.parentNodeId) {
			const parent = nodes[selectedNode.parentNodeId];

			if (parent && !parent.isDeleted) {
				const selectedIndex = getRenderedChildren(parent.id).findIndex(
					child => child.id === selectedNode.id,
				);

				if (selectedIndex >= 0) {
					navigationUtils.navigate({currentNode: parent, selectedIndex});
					return succeeded('Restored navigation to moved node', null);
				}
			}
		}
	}

	// 3. Same container still exists; use closest old index.
	if (currentNode && !currentNode.isDeleted) {
		const children = getRenderedChildren(currentNode.id);

		navigationUtils.navigate({
			currentNode,
			selectedIndex: clampIndex(anchor.selectedIndex, children.length),
		});

		return succeeded('Restored navigation to previous container', null);
	}

	// 4. Old selected parent still exists.
	if (anchor.parentNodeId) {
		const parent = nodes[anchor.parentNodeId];

		if (parent && !parent.isDeleted) {
			const children = getRenderedChildren(parent.id);

			navigationUtils.navigate({
				currentNode: parent,
				selectedIndex: clampIndex(anchor.selectedIndex, children.length),
			});

			return succeeded('Restored navigation to parent', null);
		}
	}

	const root = nodes[getState().rootNodeId];
	if (!root || root.isDeleted) return failed('Unable to restore navigation');

	navigationUtils.navigate({
		currentNode: root,
		selectedIndex: 0,
	});

	return succeeded('Restored navigation to root', null);
};
