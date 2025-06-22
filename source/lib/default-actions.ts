import {NavigateCtx} from './navigation-context.js';
import {navigationState, setState} from './state.js';
import {ActionEntry, Mode} from './types/action-map.model.js';
import {KeyIntent} from './utils/key-intent.js';

const navigateToNextItem = (ctx: NavigateCtx) => {
	const len = ctx.children.length;
	const newIndex = (ctx.getSelectedIndex() + 1) % len;
	ctx.select(newIndex);
};

const navigateToPreviousItem = (ctx: NavigateCtx) => {
	const len = ctx.children.length;
	const newIndex = (ctx.getSelectedIndex() - 1 + len) % len;
	ctx.select(newIndex);
};

export type DefaultActionMap = ActionEntry<[NavigateCtx]>[];

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
			const grandParent = ctx.breadCrumb.at(-2);
			if (!grandParent) return;
			ctx.enterParentNode();
		},
	},

	{
		intent: KeyIntent.NavPreviousItem,
		mode: Mode.DEFAULT,
		hideInHelpMenu: true,
		action: navigateToPreviousItem,
	},
	{
		intent: KeyIntent.NavToPreviousContainer,
		mode: Mode.DEFAULT,
		hideInHelpMenu: true,
		action: ctx => {
			if (!ctx.navigationNode.enableChildNavigationAcrossContainers) return;

			const ancestors = ctx.breadCrumb;
			const parent = ancestors.at(-1);
			const grandParent = ancestors.at(-2);
			if (!parent || !grandParent) return;

			const parentIndex = grandParent.children.findIndex(
				x => x.id === parent.id,
			);
			if (parentIndex <= 0) return;

			const [nextLeftSibling] = grandParent.children
				.toSpliced(parentIndex)
				.toReversed()
				.filter(x => x.children.length);
			if (!nextLeftSibling?.children?.length) return;

			const prevIndex = ctx.getSelectedIndex();
			const boundedIndex = Math.min(
				prevIndex,
				nextLeftSibling.children.length - 1,
			);
			ctx.selectNone();
			ctx.reInvokeNavigate(boundedIndex, [
				...ctx.breadCrumb.slice(0, -1),
				nextLeftSibling,
			]);
		},
	},
	{
		intent: KeyIntent.NavNextItem,
		mode: Mode.DEFAULT,
		hideInHelpMenu: true,
		action: navigateToNextItem,
	},
	{
		intent: KeyIntent.NavToNextContainer,
		mode: Mode.DEFAULT,
		hideInHelpMenu: true,
		action: ctx => {
			if (!ctx.navigationNode.enableChildNavigationAcrossContainers) return;
			const ancestors = ctx.breadCrumb;
			const parent = ancestors.at(-1);
			const grandParent = ancestors.at(-2);
			if (!parent || !grandParent) return;

			const parentIndex = grandParent.children.findIndex(
				x => x.id === parent.id,
			);
			if (parentIndex < 0 || parentIndex >= grandParent.children.length - 1)
				return;

			const [nextRightSibling] = [...grandParent.children]
				.splice(parentIndex + 1)
				.filter(x => x.children.length);
			if (!nextRightSibling?.children?.length) return;

			const prevIndex = ctx.getSelectedIndex();
			const boundedIndex = Math.min(
				prevIndex,
				nextRightSibling.children.length - 1,
			);
			ctx.selectNone();
			ctx.reInvokeNavigate(boundedIndex, [
				...ctx.breadCrumb.slice(0, -1),
				nextRightSibling,
			]);
		},
	},
];
