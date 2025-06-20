import {NavigateCtx} from './navigation-context.js';
import {ActionEntry, Mode} from './types/action-map.model.js';

export const navigationState: {
	mode: Mode;
	availableActions: ActionEntry<[NavigateCtx]>[];
	viewHelp: boolean;
} = {
	mode: 'default',
	availableActions: [],
	viewHelp: true,
};
