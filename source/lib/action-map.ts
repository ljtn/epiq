import {NavigateCtx} from './navigation-context.js';
import {ActionMap} from './types/action-map.model.js';
import {BoardItemTypes} from './types/board.model.js';
import {keys} from './utils.js';

type BoardActionMap = ActionMap<{
	BOARD: [NavigateCtx];
	SWIMLANE: [NavigateCtx];
	TICKET: [NavigateCtx];
}>;

export const BoardActions: BoardActionMap = {
	[BoardItemTypes.BOARD]: [],

	[BoardItemTypes.SWIMLANE]: [
		{
			key: keys.ARROW_DOWN,
			mode: 'default',
			description: '[ARROW_DOWN] - Enter swimlane',
			action: () => {
				// const [board, swimlane] = ctx.breadCrumb;
				// const target = swimlane.children?.[0];
				// if (target) {
				// 	ctx.push(target);
				// }
			},
		},
	],

	[BoardItemTypes.TICKET]: [
		{
			key: 'm',
			mode: 'default',
			description: 'M = Move ticket',
			action: () => {
				// const [board, swimlane, ticket] = ctx.breadCrumb;
				// Example: navigate into move mode
				// navigationState.mode = "move";
				// ctx.push(board); // or perhaps navigate to a target selection list?
				// You can trigger more complex behavior through ctx.confirm or ctx.render
			},
		},
	],
};
