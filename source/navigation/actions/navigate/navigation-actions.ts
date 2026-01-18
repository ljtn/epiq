import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {patchState} from '../../state/state.js';
import {KeyIntent} from '../../utils/key-intent.js';
import {
	enterChildNode,
	exitToParentNode,
	navigateToNextContainer,
	navigateToNextItem,
	navigateToPreviousContainer,
	navigateToPreviousItem,
} from './navigation-action-utils.js';

export const DefaultActions: ActionEntry[] = [
	{
		intent: KeyIntent.ToggleCommandLine,
		mode: Mode.DEFAULT,
		description: '[:] Toggle command line',
		action: () =>
			patchState({
				mode: Mode.COMMAND_LINE,
			}),
	},
	{
		intent: KeyIntent.ToggleCommandLine,
		mode: Mode.COMMAND_LINE,
		description: '[ESC] Toggle command line',
		action: () =>
			patchState({
				mode: Mode.DEFAULT,
			}),
	},
	// {
	// 	intent: KeyIntent.ToggleHelp,
	// 	mode: Mode.DEFAULT,
	// 	description: '[F1] Toggle HELP menu',
	// 	action: () =>
	// 		setState(state => ({
	// 			...state,
	// 			mode: Mode.HELP,
	// 		})),
	// },
	// {
	// 	intent: KeyIntent.ToggleHelp,
	// 	mode: Mode.HELP,
	// 	description: '[F1] Close HELP menu',
	// 	action: () =>
	// 		setState(state => ({
	// 			...state,
	// 			mode: Mode.DEFAULT,
	// 		})),
	// },
	{
		intent: KeyIntent.Confirm,
		mode: Mode.DEFAULT,
		description: '[ENTER/E] Confirm/Enter context',
		action: enterChildNode,
	},
	{
		intent: KeyIntent.Exit,
		mode: Mode.DEFAULT,
		description: '[ESC/Q] Exit application',
		action: exitToParentNode,
	},
	{
		mode: Mode.DEFAULT,
		description: '[ARROWS/HJKL] Navigate',
	},

	{
		intent: KeyIntent.NavPreviousItem,
		mode: Mode.DEFAULT,
		action: navigateToPreviousItem,
	},
	{
		intent: KeyIntent.NavNextItem,
		mode: Mode.DEFAULT,
		action: navigateToNextItem,
	},
	{
		intent: KeyIntent.NavToPreviousContainer,
		mode: Mode.DEFAULT,
		action: navigateToPreviousContainer,
	},
	{
		intent: KeyIntent.NavToNextContainer,
		mode: Mode.DEFAULT,
		action: navigateToNextContainer,
	},
];
