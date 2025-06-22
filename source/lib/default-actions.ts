import {NavigateCtx} from './navigation-context.js';
import {navigationState, setState} from './state.js';
import {ActionEntry, Mode} from './types/action-map.model.js';
import {KeyIntent} from './utils/key-intent.js';

export type DefaultActionMap = ActionEntry<[NavigateCtx]>[];

// -- Basic item navigation --
const navigateByOffset = (ctx: NavigateCtx, offset: number) => {
	const len = ctx.children.length;
	const newIndex = (ctx.getSelectedIndex() + offset + len) % len;
	ctx.select(newIndex);
};

const navigateToNextItem = (ctx: NavigateCtx) => navigateByOffset(ctx, 1);
const navigateToPreviousItem = (ctx: NavigateCtx) => navigateByOffset(ctx, -1);

// -- Cross-container navigation --
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

const navigateToNextContainer = (ctx: NavigateCtx) =>
	navigateToSiblingContainer(ctx, 1);
const navigateToPreviousContainer = (ctx: NavigateCtx) =>
	navigateToSiblingContainer(ctx, -1);

export const buildDefaultActions = (): DefaultActionMap => [
	{
		intent: '',
		mode: Mode.DEFAULT,
		description: '[ARROW KEYS] Navigate',
	},
	{
		intent: KeyIntent.ToggleHelp,
		mode: Mode.DEFAULT,
		action: () => setState({viewHelp: !navigationState.viewHelp}),
	},
	{
		intent: KeyIntent.Confirm,
		mode: Mode.DEFAULT,
		description: '[ENTER] Confirm',
		action: ctx => {
			const current = ctx.navigationNode.children[ctx._selectedIndex];
			if (!current) return;
			if (!current.children?.length) {
				ctx.confirm(current);
			} else {
				ctx.select(-1);
				ctx.enterChildNode(current);
			}
		},
	},
	{
		intent: KeyIntent.Exit,
		mode: Mode.DEFAULT,
		description: '[E] Exit container',
		action: ctx => {
			if (ctx.breadCrumb.length >= 2) {
				ctx.enterParentNode();
			}
		},
	},
	{
		intent: KeyIntent.NavPreviousItem,
		mode: Mode.DEFAULT,
		hideInHelpMenu: true,
		action: navigateToPreviousItem,
	},
	{
		intent: KeyIntent.NavNextItem,
		mode: Mode.DEFAULT,
		hideInHelpMenu: true,
		action: navigateToNextItem,
	},
	{
		intent: KeyIntent.NavToPreviousContainer,
		mode: Mode.DEFAULT,
		hideInHelpMenu: true,
		action: navigateToPreviousContainer,
	},
	{
		intent: KeyIntent.NavToNextContainer,
		mode: Mode.DEFAULT,
		hideInHelpMenu: true,
		action: navigateToNextContainer,
	},
];
