import {ActionMap} from '../navigation/model/action-map.model.js';
import {NavigateCtx} from '../navigation/model/navigation-ctx.model.js';
import {BoardItemTypes} from './model/board.model.js';
import {moveAcrossParents, moveWithinParent} from './move-actions-routes.js';

type BoardActionMap = ActionMap<{
	BOARD: [NavigateCtx];
	SWIMLANE: [NavigateCtx];
	TICKET: [NavigateCtx];
}>;

export const BoardActions: BoardActionMap = {
	[BoardItemTypes.BOARD]: [],
	[BoardItemTypes.SWIMLANE]: [...moveWithinParent],
	[BoardItemTypes.TICKET]: [...moveWithinParent, ...moveAcrossParents],
};
