import {NavigateCtx} from './navigation-context.js';
import {ActionEntry} from './types/action-map.model.js';

export type DefaultActionMap = ActionEntry<[NavigateCtx]>[];

export const buildDefaultActions = (): DefaultActionMap => [
	{
		key: 'return',
		description: '[ENTER] - drill down / confirm',
		action: ctx => {
			const idx = ctx.getSelectedIndex();
			const selected = ctx.children[idx];
			ctx.select(-1); // deselect in current node

			if (!selected) return;

			if (!selected.children?.length) {
				ctx.confirm(selected); // call onConfirm for leaf
			} else {
				ctx.push(selected); // dive deeper
			}
		},
	},
	{
		key: 'escape',
		description: '[ESC] - go up / select previous container',
		action: ctx => {
			const fromNode = ctx.breadCrumb.at(-1);
			const toNode = ctx.breadCrumb.at(-2);
			// const grandNode = ctx.breadCrumb.at(-3);

			if (!fromNode || !toNode) return ctx.exit();

			// Pop to the parent
			ctx.pop(); // now toNode is the selected level

			// In the parent level (grandNode), select the child that matches toNode
			// const newSelectionIndex =
			// 	grandNode?.children?.findIndex(c => c.id === toNode.id) ?? -1;
			// if (newSelectionIndex !== -1) {
			// 	ctx.select(newSelectionIndex); // highlight the node you just came from
			// } else {
			// 	ctx.selectNone();
			// }
		},
	},
	{
		key: 'up',
		description: '[↑] - previous item (vertical)',
		action: ctx => {
			if (ctx.children[0]?.navigationMode !== 'vertical') return;
			const len = ctx.children.length;
			const newIndex = (ctx.getSelectedIndex() - 1 + len) % len;
			ctx.select(newIndex);
		},
	},
	{
		key: 'down',
		description: '[↓] - next item (vertical)',
		action: ctx => {
			if (ctx.children[0]?.navigationMode !== 'vertical') return;
			const len = ctx.children.length;
			const newIndex = (ctx.getSelectedIndex() + 1) % len;
			ctx.select(newIndex);
		},
	},
	{
		key: 'left',
		description: '[←] - previous item (horizontal)',
		action: ctx => {
			if (ctx.children[0]?.navigationMode !== 'horizontal') return;
			const len = ctx.children.length;
			const newIndex = (ctx.getSelectedIndex() - 1 + len) % len;
			ctx.select(newIndex);
		},
	},
	{
		key: 'right',
		description: '[→] - next item (horizontal)',
		action: ctx => {
			if (ctx.children[0]?.navigationMode !== 'horizontal') return;
			const len = ctx.children.length;
			const newIndex = (ctx.getSelectedIndex() + 1) % len;
			ctx.select(newIndex);
		},
	},
];
