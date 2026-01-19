// navigation-context.ts

import {NavigationTree} from './navigation-tree.model.js';

export interface NavigateCtx {
	_selectionIndex: number;
	breadCrumb: Array<NavigationTree<NavigationTree>>;
	navigationNode: NavigationTree<NavigationTree>;
	children: NavigationTree[];
	getSelectedIndex(): number;
	updateSelection(index: number): void;
	selectNone(): void;
	reInvokeNavigate(
		index: number,
		breadCrumb: NavigationTree<NavigationTree>[],
	): void;
	render(): void;
	confirm(selected: NavigationTree<NavigationTree>): void;
	exit(): void;
	enterChildNode(node: NavigationTree<NavigationTree>): void; // enter child
	enterParentNode(): void; // go to parent
}
