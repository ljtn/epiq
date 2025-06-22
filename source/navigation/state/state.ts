import {ActionEntry, ModeOptions} from '../model/action-map.model.js';
import {NavigateCtx} from '../model/navigation-ctx.model.js';

export let navigationState: {
	mode: ModeOptions;
	availableActions: ActionEntry<[NavigateCtx]>[];
	viewHelp: boolean;
} = {
	mode: 'default',
	availableActions: [],
	viewHelp: false,
};

export const setState = (
	cb: (oldState: typeof navigationState) => typeof navigationState,
) => {
	navigationState = cb(navigationState);
};
