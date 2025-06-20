import {NavigateCtx} from './navigation-context.js';
import {navigationState} from './state.js';
import {ActionEntry} from './types/action-map.model.js';

export type DefaultActionMap = ActionEntry<[NavigateCtx]>[];

export const buildDefaultActions = (): DefaultActionMap => [
	{
		key: '',
		action: () => {},
		description: '[ARROW KEYS] Navigate',
	},
	{
		key: 'h',
		action: () => {
			navigationState.viewHelp = !navigationState.viewHelp;
		},
		description: '[H] Toggle view help',
	},
	{
		key: 'return',
		description: '[ENTER] Confirm',
		action: ctx => {
			const idx = ctx.getSelectedIndex();
			const selected = ctx.children[idx];
			ctx.select(-1); // deselect in current node

			if (!selected) return;

			if (!selected.children?.length) {
				ctx.confirm(selected); // call onConfirm for leaf
			} else {
				ctx.enterChild(selected); // dive deeper
			}
		},
	},
	{
		key: 'e',
		description: '[E] Exit container',
		action: ctx => ctx.enterParent(),
	},
	{
		key: 'up',
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
		description: '[→]',
		action: ctx => {
			if (ctx.children[0]?.navigationMode !== 'horizontal') return;
			const len = ctx.children.length;
			const newIndex = (ctx.getSelectedIndex() + 1) % len;
			ctx.select(newIndex);
		},
	},
];
