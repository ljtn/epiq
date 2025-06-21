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
			if (!ctx.navigationNode.children[ctx._selectedIndex]?.children.length)
				return;
			const idx = ctx.getSelectedIndex();
			const selected = ctx.children[idx];
			ctx.select(-1); // deselect in current node

			if (!selected) return;

			if (!selected.children?.length) {
				ctx.confirm(selected); // call onConfirm for leaf
			} else {
				ctx.enterChildNode(selected); // dive deeper
			}
		},
	},
	{
		key: 'e',
		mode: 'default',
		description: '[E] Exit container',
		action: ctx => ctx.enterParentNode(),
	},
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
	{
		key: 'left',
		mode: 'default',
		description: '[←]',
		action: ctx => {
			if (ctx.children[0]?.navigationMode !== 'horizontal') return;
			const len = ctx.children.length;
			const newIndex = (ctx.getSelectedIndex() - 1 + len) % len;
			ctx.select(newIndex);
		},
	},
	{
		key: 'right',
		mode: 'default',
		description: '[→]',
		action: ctx => {
			if (ctx.children[0]?.navigationMode !== 'horizontal') return;
			const len = ctx.children.length;
			const newIndex = (ctx.getSelectedIndex() + 1) % len;
			ctx.select(newIndex);
		},
	},
];
