import {NavigateCtx} from '../navigation-context.js';
import {setState} from '../state.js';
import {ActionEntry, Mode} from '../types/action-map.model.js';
import {NavigationTree} from '../types/navigation.model.js';
import {moveItemInArray} from '../utils/array-utils.js';
import {isMoveNextKey, isMovePreviousKey} from './navigation-utils.js';

// --- Mode Toggle Actions ---
export const initMoveMode: ActionEntry<[NavigateCtx]>[] = [
	{
		mapKey: 'm',
		description: '[M] Move',
		mode: Mode.DEFAULT,
		action: () => setState({mode: Mode.MOVE}),
	},
	{
		mapKey: 'm',
		description: '[M] Confirm move',
		mode: Mode.MOVE,
		action: () => setState({mode: Mode.DEFAULT}),
	},
];

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

export const moveChildToNextParent = (ctx: NavigateCtx) => {
	if (ctx.breadCrumb.at(-1)?.enableChildNavigationAcrossContainers) {
		moveNodeToSiblingContainer(ctx, 1);
	}
};
export const moveChildToPreviousParent = (ctx: NavigateCtx) => {
	if (ctx.breadCrumb.at(-1)?.enableChildNavigationAcrossContainers) {
		moveNodeToSiblingContainer(ctx, -1);
	}
};

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

export const moveChildUpWithinParent = (ctx: NavigateCtx) =>
	moveChildWithinParent(ctx, -1);
export const moveChildDownWithinParent = (ctx: NavigateCtx) =>
	moveChildWithinParent(ctx, 1);

// --- Move Actions Map ---
export const moveWithinParent: ActionEntry<[NavigateCtx]>[] = [
	{
		mapKey: isMovePreviousKey,
		mode: Mode.MOVE,
		description: '[Arrow up] Move up',
		action: moveChildUpWithinParent,
	},
	{
		mapKey: isMoveNextKey,
		mode: Mode.MOVE,
		description: '[Arrow down] Move down',
		action: moveChildDownWithinParent,
	},
];
export const moveAcrossParents: ActionEntry<[NavigateCtx]>[] = [
	{
		mapKey: 'right',
		mode: Mode.MOVE,
		description: '[Right arrow] Move to the right',
		action: moveChildToNextParent,
	},
	{
		mapKey: 'left',
		mode: Mode.MOVE,
		description: '[Left arrow] Move to the left',
		action: moveChildToPreviousParent,
	},
];
