import {BoardItemTypes} from '../../board/model/board.model.js';
import {ActionEntry, ActionMap} from '../model/action-map.model.js';
import {
	addSwimlaneAction,
	addTicketAction,
} from './add-item/add-item-actions.js';
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
	[BoardItemTypes.BOARD]: [addSwimlaneAction],
	[BoardItemTypes.SWIMLANE]: [
		...toggleMoveMode,
		...moveWithinParent,
		addTicketAction,
	],
	[BoardItemTypes.TICKET_LIST_ITEM]: [
		...toggleMoveMode,
		...moveWithinParent,
		...moveAcrossParents,
	],
	[BoardItemTypes.TICKET]: [],
};
