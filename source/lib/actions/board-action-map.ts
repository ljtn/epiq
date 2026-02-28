import {NavNodeCtx} from '../model/context.model.js';
import {ActionEntry, ActionMap} from '../model/action-map.model.js';
import {
	moveAcrossParents,
	moveWithinParent,
	toggleMoveMode,
} from './move/move-actions.js';

type ContextActions = ActionMap<{
	[NavNodeCtx.WORKSPACE]: ActionEntry[];
	[NavNodeCtx.BOARD]: ActionEntry[];
	[NavNodeCtx.SWIMLANE]: ActionEntry[];
	[NavNodeCtx.TICKET]: ActionEntry[];
	[NavNodeCtx.FIELD]: ActionEntry[];
}>;

export const contextActions: ContextActions = {
	[NavNodeCtx.WORKSPACE]: [],
	[NavNodeCtx.BOARD]: [...toggleMoveMode, ...moveWithinParent],
	[NavNodeCtx.SWIMLANE]: [
		...toggleMoveMode,
		...moveWithinParent,
		...moveAcrossParents,
	],
	[NavNodeCtx.TICKET]: [],
	[NavNodeCtx.FIELD]: [],
};
