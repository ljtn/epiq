import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {patchState} from '../../state/state.js';
import {Intent} from '../../utils/key-intent.js';
import {
	moveChildNextWithinParent,
	moveChildPreviousWithinParent,
	moveChildToNextParent,
	moveChildToPreviousParent,
} from './move-actions-utils.js';

export const toggleMoveMode: ActionEntry[] = [
	{
		intent: Intent.Exit,
		mode: Mode.MOVE,
		description: '[Y] Exit yank mode',
		action: () => {
			patchState({
				mode: Mode.DEFAULT,
			});
		},
	},
	{
		intent: Intent.InitMove,
		mode: Mode.DEFAULT,
		description: '[Y] Toggle move/yank mode',
		action: () => {
			patchState({
				mode: Mode.MOVE,
			});
		},
	},
	{
		intent: Intent.InitMove, // Change name to toggle move?
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
		intent: Intent.MovePreviousItem,
		mode: Mode.MOVE,
		action: moveChildPreviousWithinParent,
	},
	{
		intent: Intent.MoveNextItem,
		mode: Mode.MOVE,
		action: moveChildNextWithinParent,
	},
];
export const moveAcrossParents: ActionEntry[] = [
	{
		intent: Intent.MoveToNextContainer,
		mode: Mode.MOVE,
		action: moveChildToNextParent,
	},
	{
		intent: Intent.MoveToPreviousContainer,
		mode: Mode.MOVE,
		action: moveChildToPreviousParent,
	},
];
