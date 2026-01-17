import {NavigateCtx} from '../../model/navigation-ctx.model.js';
import {NavigationTree} from '../../model/navigation-tree.model.js';

function moveItemInArray<T>({
	array,
	from,
	to,
}: {
	array: T[];
	from: number;
	to: number;
}) {
	if (from < 0 || from >= array.length || to < 0 || to >= array.length) return;
	const [item] = array.splice(from, 1);
	if (item) array.splice(to, 0, item);
}

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
