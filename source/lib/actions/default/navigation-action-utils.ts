import {AnyContext} from '../../model/context.model.js';
import {NavNode} from '../../model/navigation-node.model.js';
import {getOrderedChildren} from '../../repository/rank.js';
import {getRenderedChildren, getState, patchState} from '../../state/state.js';

export const navigationUtils = {
	exit() {
		process.exit(0);
	},

	enterChildNode() {
		const state = getState();
		const contextNode = state.contextNode;
		const index = Math.max(0, state.selectedIndex);
		const focusNode = getOrderedChildren(contextNode.id)[index];
		if (!focusNode || contextNode.context === 'FIELD') return;

		navigationUtils.navigate({
			contextNode: focusNode,
			selectedIndex: getRenderedChildren(focusNode.id).length ? 0 : -1,
		});
	},

	enterParentNode() {
		const {contextNode, nodes} = getState();

		if (!contextNode.parentNodeId) {
			logger.info('Missing parent node id');
			return;
		}
		const parent = nodes[contextNode.parentNodeId];
		if (!parent) {
			logger.error('Parent not found');
			return;
		}
		const parentChildren = getRenderedChildren(parent.id);
		const idx = parentChildren.findIndex(({id}) => id === contextNode.id);
		const selectedIndex = parentChildren.length === 0 ? -1 : idx >= 0 ? idx : 0;

		navigationUtils.navigate({contextNode: parent, selectedIndex});
	},

	navigateToNextItem: () => navigateByOffset(1),
	navigateToPreviousItem: () => navigateByOffset(-1),

	navigateToNextContainer: () => navigateToSiblingContainer(1),
	navigateToPreviousContainer: () => navigateToSiblingContainer(-1),

	navigate: <T extends AnyContext>({
		contextNode,
		selectedIndex,
	}: {
		contextNode: NavNode<T>;
		selectedIndex: number;
	}): void => {
		patchState({
			contextNodeId: contextNode.id,
			selectedIndex,
		});
	},
};

const navigateByOffset = (offset: number) => {
	const {selectedIndex, contextNode} = getState();
	const len = getRenderedChildren(contextNode.id).length;
	if (len === 0) return;

	const base = Math.max(0, selectedIndex);
	const newIndex = (base + offset + len) % len;

	navigationUtils.navigate({selectedIndex: newIndex, contextNode: contextNode});
};

const navigateToSiblingContainer = (direction: -1 | 1) => {
	const {contextNode, nodes, selectedIndex} = getState();
	if (!contextNode.childNavigationAcrossParents) return;

	if (!contextNode.parentNodeId) {
		logger.error('Missing parent node id');
		return;
	}
	const parentNode = nodes[contextNode.parentNodeId];
	if (!contextNode || !parentNode) return;

	const siblings = getRenderedChildren(parentNode.id);
	const contextNodeIndex = siblings.findIndex(x => x.id === contextNode.id);
	if (contextNodeIndex < 0) return;

	const nextSibling =
		siblings.at(contextNodeIndex + direction) ?? siblings.at(0);
	if (!nextSibling) return;

	const nextSiblingChildren = getRenderedChildren(nextSibling.id);
	const maxIndex = Math.max(0, nextSiblingChildren.length - 1);
	const boundedIndex = Math.min(Math.max(0, selectedIndex), maxIndex);
	const newSelectedIndex = nextSiblingChildren.length ? boundedIndex : -1;

	navigationUtils.navigate({
		contextNode: nextSibling,
		selectedIndex: newSelectedIndex,
	});
};
