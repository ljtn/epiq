import {AnyContext} from '../../model/context.model.js';
import {NavNode} from '../../model/navigation-node.model.js';
import {getState, patchState} from '../../state/state.js';
import {filterMap} from '../../utils/array.utils.js';

export interface Navigator {
	navigate<T extends AnyContext>({
		currentNode,
		selectedIndex,
	}: {
		currentNode?: NavNode<T>;
		selectedIndex: number;
	}): void;
	exit(): void;
	enterChildNode(): void;
	enterParentNode(): void;
	navigateToNextItem: () => void;
	navigateToPreviousItem: () => void;
	navigateToNextContainer: () => void;
	navigateToPreviousContainer: () => void;
}

export const navigationUtils: Navigator = {
	exit() {
		process.exit(0);
	},

	enterChildNode() {
		const state = getState();
		const currentNode = state.currentNode;
		const index = Math.max(0, state.selectedIndex);
		const focusNodeId = currentNode.children[index];
		const focusNode = focusNodeId ? state.nodes[focusNodeId] : undefined;
		if (!focusNode || currentNode.context === 'FIELD') return;

		navigationUtils.navigate({
			currentNode: focusNode,
			selectedIndex: focusNode.children.length ? 0 : -1,
		});
	},

	enterParentNode() {
		const {currentNode, nodes} = getState();

		if (!currentNode.parentNodeId) {
			logger.error('Missing parent node id');
			return;
		}
		const parent = nodes[currentNode.parentNodeId];
		logger.debug('parent', parent);
		if (!parent) {
			logger.error('Parent not found');
			return;
		}
		const idx = parent.children.findIndex(id => id === currentNode.id);
		// logger.debug('hehe', currentNode.parentNodeId);
		const selectedIndex =
			parent.children.length === 0 ? -1 : idx >= 0 ? idx : 0;

		navigationUtils.navigate({currentNode: parent, selectedIndex});
	},

	navigateToNextItem: () => navigateByOffset(1),
	navigateToPreviousItem: () => navigateByOffset(-1),

	navigateToNextContainer: () => navigateToSiblingContainer(1),
	navigateToPreviousContainer: () => navigateToSiblingContainer(-1),

	navigate: ({currentNode = getState().currentNode, selectedIndex}) => {
		patchState({
			currentNodeId: currentNode.id,
			selectedIndex,
		});
	},
};

const navigateByOffset = (offset: number) => {
	const state = getState();
	const len = state.currentNode.children.length;
	if (len === 0) return;

	const base = Math.max(0, state.selectedIndex);
	const newIndex = (base + offset + len) % len;

	navigationUtils.navigate({selectedIndex: newIndex});
};

const navigateToSiblingContainer = (direction: -1 | 1) => {
	const {currentNode, nodes, selectedIndex} = getState();
	if (!currentNode.childNavigationAcrossParents) return;

	if (!currentNode.parentNodeId) {
		logger.error('Missing parent node id');
		return;
	}
	const parentNode = nodes[currentNode.parentNodeId];
	if (!currentNode || !parentNode) return;

	const siblings = filterMap(parentNode.children, id => nodes[id]);
	const currentNodeIndex = siblings.findIndex(x => x.id === currentNode.id);
	if (currentNodeIndex < 0) return;

	const nextSibling =
		siblings.at(currentNodeIndex + direction) ?? siblings.at(0);
	if (!nextSibling) return;

	const maxIndex = Math.max(0, nextSibling.children.length - 1);
	const boundedIndex = Math.min(Math.max(0, selectedIndex), maxIndex);
	const newSelectedIndex = nextSibling.children.length ? boundedIndex : -1;

	navigationUtils.navigate({
		currentNode: nextSibling,
		selectedIndex: newSelectedIndex,
	});
};
