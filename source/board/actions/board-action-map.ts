import {
	ActionEntryRecursive,
	ActionMap,
} from '../../navigation/model/action-map.model.js';
import {BoardItemTypes} from '../model/board.model.js';
import {
	moveAcrossParents,
	moveWithinParent,
	toggleMode,
} from './move-actions-routes.js';

type BoardActionMap = ActionMap<{
	[BoardItemTypes.BOARD]: ActionEntryRecursive[];
	[BoardItemTypes.SWIMLANE]: ActionEntryRecursive[];
	[BoardItemTypes.TICKET_LIST_ITEM]: ActionEntryRecursive[];
	[BoardItemTypes.TICKET]: ActionEntryRecursive[];
}>;

export const BoardActions: BoardActionMap = {
	[BoardItemTypes.BOARD]: [],
	[BoardItemTypes.SWIMLANE]: [...toggleMode, ...moveWithinParent],
	[BoardItemTypes.TICKET_LIST_ITEM]: [
		...toggleMode,
		...moveWithinParent,
		...moveAcrossParents,
	],
	[BoardItemTypes.TICKET]: [],
};
