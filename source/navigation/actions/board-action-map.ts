import {Context} from '../../board/model/context.model.js';
import {ActionEntry, ActionMap} from '../model/action-map.model.js';
import {
	moveAcrossParents,
	moveWithinParent,
	toggleMoveMode,
} from './move/move-actions.js';

type ContextActions = ActionMap<{
	[Context.WORKSPACE]: ActionEntry[];
	[Context.BOARD]: ActionEntry[];
	[Context.SWIMLANE]: ActionEntry[];
	[Context.TICKET_LIST_ITEM]: ActionEntry[];
	[Context.TICKET]: ActionEntry[];
}>;

export const contextActions: ContextActions = {
	[Context.WORKSPACE]: [],
	[Context.BOARD]: [...toggleMoveMode, ...moveWithinParent],
	[Context.SWIMLANE]: [
		...toggleMoveMode,
		...moveWithinParent,
		...moveAcrossParents,
	],
	[Context.TICKET_LIST_ITEM]: [],
	[Context.TICKET]: [],
};
