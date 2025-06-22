import {NavigateCtx} from '../navigation-context.js';
import {setState} from '../state.js';
import {ActionEntry, Mode} from '../types/action-map.model.js';
import {NavigationTree} from '../types/navigation.model.js';

export const initMoveMode: ActionEntry<NavigateCtx[]>[] = [
	{
		key: 'm',
		description: '[M] Move',
		mode: Mode.DEFAULT,
		action: () => {
			setState({mode: Mode.MOVE});
		},
	},
	{
		key: 'm',
		description: '[M] Confirm move',
		mode: Mode.MOVE,
		action: () => {
			setState({mode: Mode.DEFAULT});
		},
	},
];

const moveChildToNextParent = (
	ctx: NavigateCtx,
	ancestors: NavigationTree<NavigationTree>[],
) => {
	const parent = ancestors.at(-1);
	const grandParent = ancestors.at(-2);
	if (!parent || !grandParent) return;

	const parentIndex = grandParent.children.findIndex(x => x.id === parent.id);
	if (parentIndex < 0 || parentIndex >= grandParent.children.length - 1) return;

	const rightSibling = grandParent.children[parentIndex + 1];
	if (!rightSibling?.children) return;

	const index = ctx._selectedIndex;
	if (index < 0 || index >= parent.children.length) return;

	const [node] = parent.children.splice(index, 1);
	rightSibling.children.push(node as NavigationTree);

	const newBreadCrumb = [...ctx.breadCrumb.slice(0, -1), rightSibling];
	const newIndex = rightSibling.children.length - 1;
	ctx.reInvokeNavigate(newIndex, newBreadCrumb);
};

export const moveChildToPreviousParent = (
	ctx: NavigateCtx,
	ancestors: NavigationTree<NavigationTree>[],
) => {
	const parent = ancestors.at(-1);
	const grandParent = ancestors.at(-2);
	if (!parent || !grandParent) return;

	const parentIndex = grandParent.children.findIndex(x => x.id === parent.id);
	if (parentIndex <= 0) return;

	const leftSibling = grandParent.children[parentIndex - 1];
	if (!leftSibling?.children) return;

	const index = ctx._selectedIndex;
	if (index < 0 || index >= parent.children.length) return;

	const [node] = parent.children.splice(index, 1);
	leftSibling.children.push(node as NavigationTree);

	const newBreadCrumb = [...ctx.breadCrumb.slice(0, -1), leftSibling];
	const newIndex = leftSibling.children.length - 1;
	ctx.reInvokeNavigate(newIndex, newBreadCrumb);
};

export const moveActions: ActionEntry<NavigateCtx[]>[] = [
	{
		key: 'right',
		mode: Mode.MOVE,
		description: '[Right arrow] Move to the right',
		action: ctx => {
			const ancestors = ctx.breadCrumb;
			const parent = ancestors.at(-1);
			if (parent?.enableChildNavigationAcrossContainers) {
				moveChildToNextParent(ctx, ancestors);
			}
		},
	},
	{
		key: 'left',
		mode: Mode.MOVE,
		description: '[Left arrow] Move to the left',
		action: ctx => {
			const ancestors = ctx.breadCrumb;
			const parent = ancestors.at(-1);
			if (parent?.enableChildNavigationAcrossContainers) {
				moveChildToPreviousParent(ctx, ancestors);
			}
		},
	},
];
