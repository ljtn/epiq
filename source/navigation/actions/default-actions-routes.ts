import {setState} from '../state/state.js';
import {ActionEntry, Mode} from '../model/action-map.model.js';
import {
	enterChildNode,
	exitToParentNode,
	navigateToNextContainer,
	navigateToNextItem,
	navigateToPreviousContainer,
	navigateToPreviousItem,
} from './default-actions.js';
import {KeyIntent} from '../utils/key-intent.js';
import {NavigateCtx} from '../model/navigation-ctx.model.js';

export type DefaultActionMap = ActionEntry<[NavigateCtx]>[];

export const buildDefaultActions = (): DefaultActionMap => [
	{
		intent: KeyIntent.EnterContainer,
		mode: Mode.DEFAULT,
		description: '[I] Enter container',
		action: enterChildNode,
	},
	{
		intent: KeyIntent.Confirm,
		mode: Mode.DEFAULT,
		description: '[ENTER] Confirm',
		action: enterChildNode,
	},
	{
		intent: KeyIntent.Exit,
		mode: Mode.DEFAULT,
		description: '[E] Exit container',
		action: exitToParentNode,
	},
	{
		mode: Mode.DEFAULT,
		description: '[ARROW KEYS] Navigate',
	},
	{
		intent: KeyIntent.ToggleHelp,
		mode: Mode.DEFAULT,
		action: () => setState(state => ({...state, viewHelp: !state.viewHelp})),
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
