import {
	ActionEntryRecursive,
	Mode,
} from '../../navigation/model/action-map.model.js';
import {navigationState, setState} from '../../navigation/state/state.js';
import {KeyIntent} from '../../navigation/utils/key-intent.js';
import {
	moveChildNextWithinParent,
	moveChildPreviousWithinParent,
	moveChildToNextParent,
	moveChildToPreviousParent,
} from './move-actions.js';

export const toggleMode: ActionEntryRecursive[] = [
	{
		intent: KeyIntent.ToggleMove,
		mode: Mode.DEFAULT,
		description: '[M] Toggle MOVE mode',
		action: () => {
			if (navigationState.viewHelp) return;
			setState(state => ({
				...state,
				mode: Mode.MOVE,
			}));
		},
	},
	{
		intent: KeyIntent.ToggleMove,
		mode: Mode.MOVE,
		action: () => {
			if (navigationState.viewHelp) return;
			setState(state => ({
				...state,
				mode: Mode.DEFAULT,
			}));
		},
	},
];
export const moveWithinParent: ActionEntryRecursive[] = [
	{
		mode: Mode.MOVE,
		description: '[SHIFT + ARROW KEYS] Move item',
	},
	{
		intent: KeyIntent.MovePreviousItem,
		mode: Mode.MOVE,
		action: moveChildPreviousWithinParent,
	},
	{
		intent: KeyIntent.MoveNextItem,
		mode: Mode.MOVE,
		action: moveChildNextWithinParent,
	},
];
export const moveAcrossParents: ActionEntryRecursive[] = [
	{
		intent: KeyIntent.MoveToNextContainer,
		mode: Mode.MOVE,
		action: moveChildToNextParent,
	},
	{
		intent: KeyIntent.MoveToPreviousContainer,
		mode: Mode.MOVE,
		action: moveChildToPreviousParent,
	},
];
