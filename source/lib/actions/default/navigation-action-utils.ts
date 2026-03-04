import {BreadCrumb} from '../../model/app-state.model.js';
import {AnyContext} from '../../model/context.model.js';
import {NavNode} from '../../model/navigation-node.model.js';
import {getState, patchState} from '../../state/state.js';

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
		logger.info(sel);
	},

	exit() {
		process.exit(0);
	},

	enterChildNode() {
		const state = getState();
		const currentNode = state.currentNode;

		if (!currentNode || currentNode.children.length === 0) return;

		const idx = state.selectedIndex < 0 ? 0 : state.selectedIndex;
		const focusNode = currentNode.children[idx];
		if (!focusNode || focusNode.context === 'FIELD') return;

		navigator.navigate({
			currentNode: focusNode,
			selectedIndex: focusNode.children.length ? 0 : -1,
		});
	},

	enterParentNode() {
		const breadCrumb = getState().breadCrumb;
		if (breadCrumb.length < 2) return;

		const current = breadCrumb.at(-1)!;
		const parent = breadCrumb.at(-2)!;

		const idx = parent.children.findIndex(x => x.id === current.id);
		const selectedIndex =
			parent.children.length === 0 ? -1 : idx >= 0 ? idx : 0;

		navigator.navigate({currentNode: parent, selectedIndex});
	},

	navigateToNextItem: () => navigateByOffset(1),
	navigateToPreviousItem: () => navigateByOffset(-1),

	navigateToNextContainer: () => navigateToSiblingContainer(1),
	navigateToPreviousContainer: () => navigateToSiblingContainer(-1),

	navigate: ({currentNode = getState().currentNode, selectedIndex}) => {
		const findBreadCrumb = (
			node: NavNode<AnyContext>,
			targetId: string,
			path: BreadCrumb | [] = [],
		): BreadCrumb | undefined => {
			const nextPath = [...path, node] as BreadCrumb;
			if (node.id === targetId) return nextPath;

			for (const child of node.children) {
				const found = findBreadCrumb(
					child as NavNode<AnyContext>,
					targetId,
					nextPath,
				);
				if (found) return found;
			}
			return;
		};

		const root = getState().rootNode;
		const breadCrumb = findBreadCrumb(root, currentNode.id);
		if (!breadCrumb) return;

		patchState({
			breadCrumb,
			currentNode: breadCrumb.at(-1)!,
			selectedIndex,
		});
	},
};

const navigateByOffset = (offset: number) => {
	const state = getState();
	const len = state.currentNode.children.length;
	if (len === 0) return;

	const base = state.selectedIndex < 0 ? 0 : state.selectedIndex;
	const newIndex = (base + offset + len) % len;

	navigator.navigate({selectedIndex: newIndex});
};

const navigateToSiblingContainer = (direction: -1 | 1) => {
	const state = getState();
	if (!state.currentNode.childNavigationAcrossParents) return;

	const currentNode = state.breadCrumb.at(-1);
	const parentNode = state.breadCrumb.at(-2);
	if (!currentNode || !parentNode) return;

	const siblings = parentNode.children;
	const currentNodeIndex = siblings.findIndex(x => x.id === currentNode.id);
	if (currentNodeIndex < 0) return;

	const nextSibling =
		siblings.at(currentNodeIndex + direction) ?? siblings.at(0);
	if (!nextSibling) return;

	const maxIndex = Math.max(0, nextSibling.children.length - 1);
	const boundedIndex = Math.min(Math.max(0, state.selectedIndex), maxIndex);
	const selectedIndex = nextSibling.children.length ? boundedIndex : -1;

	navigator.navigate({currentNode: nextSibling, selectedIndex});
};
