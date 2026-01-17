import {BoardItemTypes} from '../../board/model/board.model.js';
import {ActionEntry, ActionMap} from '../model/action-map.model.js';
import {
	moveAcrossParents,
	moveWithinParent,
	toggleMode,
} from './move/move-actions-routes.js';

type BoardActionMap = ActionMap<{
	[BoardItemTypes.BOARD]: ActionEntry[];
	[BoardItemTypes.SWIMLANE]: ActionEntry[];
	[BoardItemTypes.TICKET_LIST_ITEM]: ActionEntry[];
	[BoardItemTypes.TICKET]: ActionEntry[];
}>;

export const ContextualActionMap: BoardActionMap = {
	[BoardItemTypes.BOARD]: [],
	[BoardItemTypes.SWIMLANE]: [...toggleMode, ...moveWithinParent],
	[BoardItemTypes.TICKET_LIST_ITEM]: [
		...toggleMode,
		...moveWithinParent,
		...moveAcrossParents,
	],
	[BoardItemTypes.TICKET]: [],
};
