import {AnyContext} from '../../../board/model/context.model.js';
import {NavigationTree} from '../../model/navigation-tree.model.js';
import {appState, patchState} from '../../state/state.js';

export interface Navigator {
	navigate<T extends AnyContext>({
		currentNode,
		selectedIndex,
	}: {
		currentNode?: NavigationTree<T>;
		selectedIndex: number;
	}): void;
	confirm<T extends AnyContext>(selected: NavigationTree<T>): void;
	exit(): void;
	enterChildNode(): void;
	enterParentNode(): void;
	navigateToNextItem: () => void;
	navigateToPreviousItem: () => void;
	navigateToNextContainer: () => void;
	navigateToPreviousContainer: () => void;
}

export const navigator: Navigator = {
	confirm(sel) {
		console.log(sel);
	},
	exit() {
		process.exit(0);
	},

	enterChildNode() {
		const currentNode = appState.currentNode;
		const focusNode = currentNode?.children[appState.selectedIndex];

		if (!currentNode || !focusNode) return;

		navigator.navigate({
			currentNode: focusNode,
			selectedIndex: 0,
		});
	},

	enterParentNode() {
		const breadCrumb = appState.breadCrumb;
		if (breadCrumb.length < 2) return;

		const prevNode = breadCrumb.at(-1);
		if (!prevNode) return;

		const newCurrentNode = breadCrumb.at(-2)!;
		const newIndex =
			newCurrentNode?.children?.findIndex(x => x.id === prevNode.id) ?? 0;

		navigator.navigate({
			currentNode: newCurrentNode,
			selectedIndex: newIndex,
		});
	},

	navigateToNextItem: () => navigateByOffset(1),
	navigateToPreviousItem: () => navigateByOffset(-1),

	navigateToNextContainer: () => navigateToSiblingContainer(1),
	navigateToPreviousContainer: () => navigateToSiblingContainer(-1),

	navigate: ({currentNode = appState.currentNode, selectedIndex}) => {
		const findBreadCrumb = (
			node: NavigationTree<AnyContext>,
			targetId: string,
			path: NavigationTree<AnyContext>[] = [],
		): NavigationTree<AnyContext>[] => {
			const nextPath = [...path, node];
			if (node.id === targetId) return nextPath;

			for (const child of node.children ?? []) {
				const found = findBreadCrumb(child, targetId, nextPath);
				if (found.length) return found;
			}
			return [];
		};

		const setIsSelected = (
			node: NavigationTree<AnyContext>,
			targetId: string,
			selectedIndex: number,
		) => {
			// Clear selection for all children at this node
			for (const child of node.children ?? []) {
				child.isSelected = false;
				setIsSelected(child, targetId, selectedIndex);
			}

			// If this is the target container, select its child at selectedIndex
			if (node.id === targetId) {
				const children = node.children;

				const idx = Math.max(0, Math.min(selectedIndex, children.length - 1));
				if (children[idx]) {
					children[idx].isSelected = true;
				}
			}
		};

		const root = appState.rootNode;
		const breadCrumb = findBreadCrumb(root, currentNode.id);

		setIsSelected(root, currentNode.id, selectedIndex);
		patchState({
			breadCrumb,
			currentNode,
			selectedIndex,
		});
	},
};

const navigateByOffset = (offset: number) => {
	const len = appState.currentNode.children.length;
	if (len === 0) return;

	const newIndex = (appState.selectedIndex + offset + len) % len;
	navigator.navigate({selectedIndex: newIndex});
};
const navigateToSiblingContainer = (direction: -1 | 1) => {
	if (!appState.currentNode.enableChildNavigationAcrossContainers) return;

	const currentNode = appState.breadCrumb.at(-1);
	const parentNode = appState.breadCrumb.at(-2);
	if (!currentNode || !parentNode) return;

	const siblings = parentNode.children ?? [];
	const currentNodeIndex = siblings.findIndex(x => x.id === currentNode.id);
	if (currentNodeIndex < 0) return;

	// Look for the next sibling "container" that actually has children
	const candidates =
		direction === -1
			? siblings.slice(0, currentNodeIndex).toReversed()
			: siblings.slice(currentNodeIndex + 1);

	const nextSibling = candidates.find(x => (x.children?.length ?? 0) > 0);
	if (!nextSibling?.children?.length) return;

	// Keep the same child index if possible, otherwise clamp to last child
	const prevIndex = appState.selectedIndex;
	const boundedIndex = Math.min(prevIndex, nextSibling.children.length - 1);

	navigator.navigate({
		currentNode: nextSibling,
		selectedIndex: boundedIndex,
	});
};
