import {NavigateCtx} from './navigation-context.js';
import {ActionEntry, ModeOptions} from './types/action-map.model.js';

export let navigationState: {
	mode: ModeOptions;
	availableActions: ActionEntry<[NavigateCtx]>[];
	viewHelp: boolean;
} = {
	mode: 'default',
	availableActions: [],
	viewHelp: false,
};

export const setState = (newState: Partial<typeof navigationState>) => {
	return (navigationState = {
		...navigationState,
		...newState,
	});
};
