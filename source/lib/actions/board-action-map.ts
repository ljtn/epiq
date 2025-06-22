import {initMoveMode, moveActions} from './move-actions.js';
import {NavigateCtx} from '../navigation-context.js';
import {ActionMap} from '../types/action-map.model.js';
import {BoardItemTypes} from '../types/board.model.js';

type BoardActionMap = ActionMap<{
	BOARD: [NavigateCtx];
	SWIMLANE: [NavigateCtx];
	TICKET: [NavigateCtx];
}>;

export const BoardActions: BoardActionMap = {
	[BoardItemTypes.BOARD]: [],
	[BoardItemTypes.SWIMLANE]: [...initMoveMode, ...moveActions],
	[BoardItemTypes.TICKET]: [...initMoveMode, ...moveActions],
};
