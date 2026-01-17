import {ActionEntryRecursive, Mode} from '../model/action-map.model.js';
import {setState} from '../state/state.js';
import {KeyIntent} from '../utils/key-intent.js';
import {
	enterChildNode,
	exitToParentNode,
	navigateToNextContainer,
	navigateToNextItem,
	navigateToPreviousContainer,
	navigateToPreviousItem,
} from './default-actions.js';

export type DefaultActionMap = ActionEntryRecursive[];

export const buildDefaultActions = (): DefaultActionMap => [
	{
		intent: KeyIntent.ToggleHelp,
		mode: Mode.DEFAULT,
		description: '[H] Toggle HELP menu',
		action: () =>
			setState(state => ({
				...state,
				mode: Mode.HELP,
			})),
	},
	{
		intent: KeyIntent.Confirm,
		mode: Mode.DEFAULT,
		description: '[ENTER] Confirm / Enter context',
		action: enterChildNode,
	},
	{
		intent: KeyIntent.Exit,
		mode: Mode.DEFAULT,
		description: '[E] Exit context to parent',
		action: exitToParentNode,
	},
	{
		mode: Mode.DEFAULT,
		description: '[ARROW KEYS] Navigate',
	},

	{
		intent: KeyIntent.ToggleHelp,
		mode: Mode.HELP,
		action: () =>
			setState(state => ({
				...state,
				mode: Mode.DEFAULT,
			})),
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
