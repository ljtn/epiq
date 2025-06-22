import {NavigateCtx} from '../navigation-context.js';
import {ActionEntry, Mode} from '../types/action-map.model.js';
import {KeyIntent} from '../utils/key-intent.js';
import {
	moveChildNextWithinParent,
	moveChildPreviousWithinParent,
	moveChildToNextParent,
	moveChildToPreviousParent,
} from './move-actions.js';

export const moveWithinParent: ActionEntry<[NavigateCtx]>[] = [
	{
		mode: Mode.DEFAULT,
		description: '[Shift + direction] Move item',
	},
	{
		intent: KeyIntent.MovePreviousItem,
		mode: Mode.DEFAULT,
		action: moveChildPreviousWithinParent,
	},
	{
		intent: KeyIntent.MoveNextItem,
		mode: Mode.DEFAULT,
		action: moveChildNextWithinParent,
	},
];
export const moveAcrossParents: ActionEntry<[NavigateCtx]>[] = [
	{
		intent: KeyIntent.MoveToNextContainer,
		mode: Mode.DEFAULT,
		action: moveChildToNextParent,
	},
	{
		intent: KeyIntent.MoveToPreviousContainer,
		mode: Mode.DEFAULT,
		action: moveChildToPreviousParent,
	},
];
