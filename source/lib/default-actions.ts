import {NavigateCtx} from './navigation-context.js';
import {navigationState} from './state.js';
import {ActionEntry} from './types/action-map.model.js';

export type DefaultActionMap = ActionEntry<[NavigateCtx]>[];

export const buildDefaultActions = (): DefaultActionMap => [
	{
		key: '',
		mode: 'default',
		action: () => {},
		description: '[ARROW KEYS] Navigate',
	},
	{
		key: 'h',
		mode: 'default',
		action: () => {
			navigationState.viewHelp = !navigationState.viewHelp;
		},
		description: '',
	},
	{
		key: 'return',
		mode: 'default',
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
		key: 'e',
		mode: 'default',
		description: '[E] Exit container',
		action: ctx => ctx.enterParentNode(),
	},

	// Vertical movement
	{
		key: 'up',
		mode: 'default',
		description: '[↑]',
		action: ctx => {
			if (ctx.children[0]?.navigationMode !== 'vertical') return;
			const len = ctx.children.length;
			const newIndex = (ctx.getSelectedIndex() - 1 + len) % len;
			ctx.select(newIndex);
		},
	},
	{
		key: 'down',
		mode: 'default',
		description: '[↓]',
		action: ctx => {
			if (ctx.children[0]?.navigationMode !== 'vertical') return;
			const len = ctx.children.length;
			const newIndex = (ctx.getSelectedIndex() + 1) % len;
			ctx.select(newIndex);
		},
	},

	// Horizontal movement within current node
	{
		key: 'left',
		mode: 'default',
		description: '[←]',
		action: ctx => {
			const navMode = ctx.children[0]?.navigationMode;
			if (navMode === 'horizontal') {
				const len = ctx.children.length;
				const newIndex = (ctx.getSelectedIndex() - 1 + len) % len;
				ctx.select(newIndex);
				return;
			}

			if (navMode !== 'vertical') return;

			const ancestors = ctx.breadCrumb;
			const parent = ancestors.at(-1);
			const grandParent = ancestors.at(-2);
			if (!parent || !grandParent) return;

			const parentIndex = grandParent.children.findIndex(
				x => x.id === parent.id,
			);
			if (parentIndex <= 0) return;

			const leftSibling = grandParent.children[parentIndex - 1];
			if (!leftSibling?.children?.length) return;

			const prevIndex = ctx.getSelectedIndex();
			const boundedIndex = Math.min(prevIndex, leftSibling.children.length - 1);
			ctx.selectNone();
			ctx.reInvokeNavigate(boundedIndex, [
				...ctx.breadCrumb.slice(0, -1),
				leftSibling,
			]);
		},
	},
	{
		key: 'right',
		mode: 'default',
		description: '[→]',
		action: ctx => {
			const navMode = ctx.children[0]?.navigationMode;
			if (navMode === 'horizontal') {
				const len = ctx.children.length;
				const newIndex = (ctx.getSelectedIndex() + 1) % len;
				ctx.select(newIndex);
				return;
			}

			if (navMode !== 'vertical') return;

			const ancestors = ctx.breadCrumb;
			const parent = ancestors.at(-1);
			const grandParent = ancestors.at(-2);
			if (!parent || !grandParent) return;

			const parentIndex = grandParent.children.findIndex(
				x => x.id === parent.id,
			);
			if (parentIndex < 0 || parentIndex >= grandParent.children.length - 1)
				return;

			const rightSibling = grandParent.children[parentIndex + 1];
			if (!rightSibling?.children?.length) return;

			const prevIndex = ctx.getSelectedIndex();
			const boundedIndex = Math.min(
				prevIndex,
				rightSibling.children.length - 1,
			);
			ctx.selectNone();
			ctx.reInvokeNavigate(boundedIndex, [
				...ctx.breadCrumb.slice(0, -1),
				rightSibling,
			]);
		},
	},
];
