import {BoardItemTypes} from '../../board/model/board.model.js';
import {ActionEntry, ActionMap} from '../model/action-map.model.js';
import {
	moveAcrossParents,
	moveWithinParent,
	toggleMoveMode,
} from './move/move-actions.js';

type BoardActionMap = ActionMap<{
	[BoardItemTypes.BOARD]: ActionEntry[];
	[BoardItemTypes.SWIMLANE]: ActionEntry[];
	[BoardItemTypes.TICKET_LIST_ITEM]: ActionEntry[];
	[BoardItemTypes.TICKET]: ActionEntry[];
}>;

export const ContextualActionMap: BoardActionMap = {
	[BoardItemTypes.BOARD]: [...toggleMoveMode, ...moveWithinParent],
	[BoardItemTypes.SWIMLANE]: [
		...toggleMoveMode,
		...moveWithinParent,
		...moveAcrossParents,
	],
	[BoardItemTypes.TICKET_LIST_ITEM]: [],
	[BoardItemTypes.TICKET]: [],
};
