import {NavigateCtx} from './navigation-context.js';
import {navigationState} from './state.js';
import {ActionMap} from './types/action-map.model.js';
import {BoardItemTypes} from './types/board.model.js';

type BoardActionMap = ActionMap<{
	BOARD: [NavigateCtx];
	SWIMLANE: [NavigateCtx];
	TICKET: [NavigateCtx];
}>;

export const BoardActions: BoardActionMap = {
	[BoardItemTypes.BOARD]: [],
	[BoardItemTypes.SWIMLANE]: [],
	[BoardItemTypes.TICKET]: [
		{
			key: 'm',
			mode: 'default',
			description: '[M] Move ticket',
			action: () => {
				navigationState.mode = 'move';
			},
		},
		{
			key: 'right',
			mode: 'move',
			description: '[right] Move to left',
			action: ctx => {
				const ancestors = ctx.breadCrumb;
				const parent = ancestors[ancestors.length - 1];
				const grandParent = ancestors[ancestors.length - 2];
				if (!parent || !grandParent) return;
				const parentIndex = grandParent?.children.findIndex(
					x => parent.id === x.id,
				);
				if (!(parentIndex > 0)) return;
				if (!grandParent.children.length) return;
				parent.children.splice(ctx._selectedIndex, 1);
				grandParent.children[parentIndex + 1]?.children.push(
					ctx.navigationNode,
				);
			},
		},
	],
};
