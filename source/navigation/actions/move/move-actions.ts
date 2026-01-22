import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {patchState} from '../../state/state.js';
import {KeyIntent} from '../../utils/key-intent.js';
import {
	moveChildNextWithinParent,
	moveChildPreviousWithinParent,
	moveChildToNextParent,
	moveChildToPreviousParent,
} from './move-actions-utils.js';

export const toggleMoveMode: ActionEntry[] = [
	{
		intent: KeyIntent.Exit,
		mode: Mode.MOVE,
		description: '[Y] Exit yank mode',
		action: () => {
			patchState({
				mode: Mode.DEFAULT,
			});
		},
	},
	{
		intent: KeyIntent.ToggleMove,
		mode: Mode.DEFAULT,
		description: '[Y] Toggle move/yank mode',
		action: () => {
			patchState({
				mode: Mode.MOVE,
			});
		},
	},
	{
		intent: KeyIntent.ToggleMove,
		mode: Mode.MOVE,
		action: () => {
			patchState({
				mode: Mode.DEFAULT,
			});
		},
	},
];
export const moveWithinParent: ActionEntry[] = [
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
