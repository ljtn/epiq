import {NavNodeType} from '../model/context.model.js';
import {ActionEntry, ActionMap} from '../model/action-map.model.js';
import {
	moveAcrossParents,
	moveWithinParent,
	toggleMoveMode,
} from './move/move-actions.js';

type ContextActions = ActionMap<{
	[NavNodeType.WORKSPACE]: ActionEntry[];
	[NavNodeType.BOARD]: ActionEntry[];
	[NavNodeType.SWIMLANE]: ActionEntry[];
	[NavNodeType.TICKET]: ActionEntry[];
	[NavNodeType.FIELD]: ActionEntry[];
}>;

export const contextActions: ContextActions = {
	[NavNodeType.WORKSPACE]: [],
	[NavNodeType.BOARD]: [...toggleMoveMode, ...moveWithinParent],
	[NavNodeType.SWIMLANE]: [
		...toggleMoveMode,
		...moveWithinParent,
		...moveAcrossParents,
	],
	[NavNodeType.TICKET]: [],
	[NavNodeType.FIELD]: [],
};
