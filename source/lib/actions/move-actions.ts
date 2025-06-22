import {NavigateCtx} from '../navigation-context.js';
import {ActionEntry, Mode} from '../types/action-map.model.js';
import {NavigationTree} from '../types/navigation.model.js';
import {moveItemInArray} from '../utils/array-utils.js';
import {KeyIntent} from '../utils/key-intent.js';

// --- Core Move Helpers ---
function moveNodeToSiblingContainer(ctx: NavigateCtx, direction: -1 | 1) {
	const ancestors = ctx.breadCrumb;
	const parent = ancestors.at(-1);
	const grandParent = ancestors.at(-2);
	if (!parent || !grandParent) return;

	const parentIndex = grandParent.children.findIndex(x => x.id === parent.id);
	const targetIndex = parentIndex + direction;
	if (
		parentIndex < 0 ||
		targetIndex < 0 ||
		targetIndex >= grandParent.children.length
	)
		return;

	const sibling = grandParent.children[targetIndex];
	if (!sibling) return;
	if (!sibling?.children?.length && !Array.isArray(sibling.children)) return;

	const currentIndex = ctx._selectedIndex;
	if (currentIndex < 0 || currentIndex >= parent.children.length) return;

	const [node] = parent.children.splice(currentIndex, 1);
	sibling.children.push(node as NavigationTree);

	const newBreadCrumb = [...ctx.breadCrumb.slice(0, -1), sibling];
	const newIndex = sibling.children.length - 1;
	ctx.reInvokeNavigate(newIndex, newBreadCrumb);
}

export const moveChildToNextParent = (ctx: NavigateCtx) =>
	moveNodeToSiblingContainer(ctx, 1);
export const moveChildToPreviousParent = (ctx: NavigateCtx) =>
	moveNodeToSiblingContainer(ctx, -1);

function moveChildWithinParent(ctx: NavigateCtx, direction: -1 | 1) {
	const from = ctx._selectedIndex;
	const to = from + direction;
	if (to < 0 || to >= ctx.navigationNode.children.length) return;
	moveItemInArray({
		array: ctx.navigationNode.children,
		from,
		to,
	});
	ctx.select(to);
}

export const moveChildPreviousWithinParent = (ctx: NavigateCtx) =>
	moveChildWithinParent(ctx, -1);

export const moveChildNextWithinParent = (ctx: NavigateCtx) =>
	moveChildWithinParent(ctx, 1);

// --- Move Actions Map ---
export const moveWithinParent: ActionEntry<[NavigateCtx]>[] = [
	{
		intent: KeyIntent.MovePreviousItem,
		mode: Mode.DEFAULT,
		description: '[Shift + direction] Move backward',
		hideInHelpMenu: true,
		action: moveChildPreviousWithinParent,
	},
	{
		intent: KeyIntent.MoveNextItem,
		mode: Mode.DEFAULT,
		description: '[Shift + direction] Move forward',
		hideInHelpMenu: true,
		action: moveChildNextWithinParent,
	},
	{
		intent: '',
		mode: Mode.DEFAULT,
		description: '[Shift + direction] Move item',
		action: () => {},
	},
];
export const moveAcrossParents: ActionEntry<[NavigateCtx]>[] = [
	{
		intent: KeyIntent.MoveToNextContainer,
		mode: Mode.DEFAULT,
		description: '[Shift + direction] Move to next container',
		hideInHelpMenu: true,
		action: moveChildToNextParent,
	},
	{
		intent: KeyIntent.MoveToPreviousContainer,
		mode: Mode.DEFAULT,
		description: '[Shift + direction] Move to previous container',
		hideInHelpMenu: true,
		action: moveChildToPreviousParent,
	},
];
