import {AnyContext} from '../../model/context.model.js';
import {NavNode} from '../../model/navigation-node.model.js';
import {appState, BreadCrumb, patchState} from '../../state/state.js';

export interface Navigator {
	navigate<T extends AnyContext>({
		currentNode,
		selectedIndex,
	}: {
		currentNode?: NavNode<T>;
		selectedIndex: number;
	}): void;
	confirm<T extends AnyContext>(selected: NavNode<T>): void;
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

		const isEndNode = focusNode?.context === 'FIELD'; // Reconsider. Not sure we want this to be the end node in the future
		if (!currentNode || !focusNode || isEndNode) return;

		navigator.navigate({
			currentNode: focusNode,
			selectedIndex: focusNode.children.length ? 0 : -1,
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
			node: NavNode<AnyContext>,
			targetId: string,
			path?: BreadCrumb,
		): BreadCrumb | void => {
			const nextPath = [...(path ?? []), node] as BreadCrumb;
			if (node.id === targetId) return nextPath;

			for (const child of node.children ?? []) {
				const found = findBreadCrumb(child, targetId, nextPath);
				if (found?.length) return found;
			}
			return;
		};

		const setIsSelected = (
			node: NavNode<AnyContext>,
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
		if (!breadCrumb) return;

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
	if (!appState.currentNode.childNavigationAcrossParents) return;

	const currentNode = appState.breadCrumb.at(-1);
	const parentNode = appState.breadCrumb.at(-2);
	if (!currentNode || !parentNode) return;

	const siblings = parentNode.children ?? [];
	const currentNodeIndex = siblings.findIndex(x => x.id === currentNode.id);
	if (currentNodeIndex < 0) return;

	const nextSibling =
		siblings.at(currentNodeIndex + direction) || siblings.at(0);
	if (!nextSibling) return;

	// Keep the same child index if possible, otherwise clamp to last child
	const prevIndex = appState.selectedIndex;
	const maxIndex = Math.max(0, nextSibling.children.length - 1);
	const boundedIndex = Math.min(Math.max(0, prevIndex), maxIndex);

	const selectedIndex = nextSibling.children.length ? boundedIndex : -1;

	navigator.navigate({
		currentNode: nextSibling,
		selectedIndex,
	});
};
