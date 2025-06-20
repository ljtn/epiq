// navigation-context.ts
import {NavigationTree} from './types/navigation.model.js';

export interface NavigateCtx {
	_selectedIndex: number;
	breadCrumb: Array<NavigationTree<NavigationTree>>;
	navigationNode: NavigationTree<NavigationTree>;
	children: NavigationTree[];
	getSelectedIndex(): number;
	select(index: number): void;
	selectNone(): void;
	render(): void;
	confirm(selected: NavigationTree): void;
	exit(): void;
	push(node: NavigationTree): void; // enter child
	pop(): void; // go to parent
}
