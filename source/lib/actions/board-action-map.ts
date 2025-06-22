import {NavigateCtx} from '../navigation-context.js';
import {ActionMap} from '../types/action-map.model.js';
import {BoardItemTypes} from '../types/board.model.js';
import {
	initMoveMode,
	moveAcrossParents,
	moveWithinParent,
} from './move-actions.js';

type BoardActionMap = ActionMap<{
	BOARD: [NavigateCtx];
	SWIMLANE: [NavigateCtx];
	TICKET: [NavigateCtx];
}>;

export const BoardActions: BoardActionMap = {
	[BoardItemTypes.BOARD]: [],
	[BoardItemTypes.SWIMLANE]: [...initMoveMode, ...moveWithinParent],
	[BoardItemTypes.TICKET]: [
		...initMoveMode,
		...moveWithinParent,
		...moveAcrossParents,
	],
};
