import {ActionEntry, ActionIndex} from '../model/action-map.model.js';

export const buildActionIndex = (
	actions: readonly ActionEntry[],
): ActionIndex => {
	const index: ActionIndex = {};

	for (const action of actions) {
		if (!action.intent) continue;

		if (!index[action.mode]) {
			index[action.mode] = {};
		}

		index[action.mode]![action.intent] = action;
	}

	return index;
};
