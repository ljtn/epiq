import {ActionEntry, Mode} from '../navigation/model/action-map.model.js';
import {NavigateCtx} from '../navigation/model/navigation-ctx.model.js';
import {KeyIntent} from '../navigation/utils/key-intent.js';
import {
	moveChildNextWithinParent,
	moveChildPreviousWithinParent,
	moveChildToNextParent,
	moveChildToPreviousParent,
} from './move-actions.js';

export const moveWithinParent: ActionEntry<[NavigateCtx]>[] = [
	{
		mode: Mode.DEFAULT,
		description: '[SHIFT + ARROW KEYS] Move item',
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
