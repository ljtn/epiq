import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {setState} from '../../state/state.js';
import {KeyIntent} from '../../utils/key-intent.js';
import {
	moveChildNextWithinParent,
	moveChildPreviousWithinParent,
	moveChildToNextParent,
	moveChildToPreviousParent,
} from './move-actions-utils.js';

export const toggleMoveMode: ActionEntry[] = [
	{
		intent: KeyIntent.ToggleMove,
		mode: Mode.DEFAULT,
		description: '[Y] Toggle move/yank mode',
		action: () => {
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
			setState(state => ({
				...state,
				mode: Mode.DEFAULT,
			}));
		},
	},
];
export const moveWithinParent: ActionEntry[] = [
	{
		mode: Mode.MOVE,
		description: '[Y, ARROW KEYS] Move item',
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
export const moveAcrossParents: ActionEntry[] = [
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
