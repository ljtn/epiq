import {NavigateCtx} from '../model/navigation-ctx.model.js';

const navigateByOffset = (ctx: NavigateCtx, offset: number) => {
	const len = ctx.children.length;
	const newIndex = (ctx.getSelectedIndex() + offset + len) % len;
	ctx.select(newIndex);
};

export const navigateToNextItem = (ctx: NavigateCtx) =>
	navigateByOffset(ctx, 1);
export const navigateToPreviousItem = (ctx: NavigateCtx) =>
	navigateByOffset(ctx, -1);

const navigateToSiblingContainer = (ctx: NavigateCtx, direction: -1 | 1) => {
	if (!ctx.navigationNode.enableChildNavigationAcrossContainers) return;

	const parent = ctx.breadCrumb.at(-1);
	const grandParent = ctx.breadCrumb.at(-2);
	if (!parent || !grandParent) return;

	const parentIndex = grandParent.children.findIndex(x => x.id === parent.id);
	const sliced =
		direction === -1
			? grandParent.children.toSpliced(parentIndex).toReversed()
			: grandParent.children.slice(parentIndex + 1);

	const nextSibling = sliced.find(x => x.children.length);
	if (!nextSibling?.children?.length) return;

	const prevIndex = ctx.getSelectedIndex();
	const boundedIndex = Math.min(prevIndex, nextSibling.children.length - 1);

	ctx.selectNone();
	ctx.reInvokeNavigate(boundedIndex, [
		...ctx.breadCrumb.slice(0, -1),
		nextSibling,
	]);
};

export const navigateToNextContainer = (ctx: NavigateCtx) =>
	navigateToSiblingContainer(ctx, 1);
export const navigateToPreviousContainer = (ctx: NavigateCtx) =>
	navigateToSiblingContainer(ctx, -1);

export const enterChildNode = (ctx: NavigateCtx) => {
	const current = ctx.navigationNode.children[ctx._selectedIndex];
	if (!current) return;
	if (!current.children?.length) {
		ctx.confirm(current);
	} else {
		ctx.select(-1);
		ctx.enterChildNode(current);
	}
};

export const exitToParentNode = (ctx: NavigateCtx) => {
	if (ctx.breadCrumb.length >= 2) {
		ctx.enterParentNode();
	}
};
