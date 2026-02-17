import {contextMap} from '../../model/context.model.js';
import {ActionEntry, ActionMap} from '../model/action-map.model.js';
import {
	moveAcrossParents,
	moveWithinParent,
	toggleMoveMode,
} from './move/move-actions.js';

type ContextActions = ActionMap<{
	[contextMap.WORKSPACE]: ActionEntry[];
	[contextMap.BOARD]: ActionEntry[];
	[contextMap.SWIMLANE]: ActionEntry[];
	[contextMap.TICKET]: ActionEntry[];
	[contextMap.TICKET_FIELD]: ActionEntry[];
}>;

export const contextActions: ContextActions = {
	[contextMap.WORKSPACE]: [],
	[contextMap.BOARD]: [...toggleMoveMode, ...moveWithinParent],
	[contextMap.SWIMLANE]: [
		...toggleMoveMode,
		...moveWithinParent,
		...moveAcrossParents,
	],
	[contextMap.TICKET]: [],
	[contextMap.TICKET_FIELD]: [],
};
