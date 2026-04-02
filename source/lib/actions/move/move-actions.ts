import {failed, succeeded} from '../../command-line/command-types.js';
import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {getState, patchState} from '../../state/state.js';
import {Intent} from '../../utils/key-intent.js';
import {
	moveChildWithinParent,
	moveNodeToSiblingContainer,
} from './move-actions-utils.js';

export const toggleMoveMode: ActionEntry[] = [
	{
		// Reconsider. We should probably not move before confirm
		intent: Intent.Exit,
		mode: Mode.MOVE,
		description: '[esc] cancel',
		action: () => {
			patchState({
				mode: Mode.DEFAULT,
			});
			return succeeded('Cancelling move', null);
		},
	},
	{
		intent: Intent.Cut,
		mode: Mode.DEFAULT,
		description: '[d] cut',
		action: () => {
			if (getState().selectedIndex === -1) return failed('No item selected'); // Block move if no children
			patchState({
				mode: Mode.MOVE,
			});
			return succeeded('Cutting item', null);
		},
	},
	{
		intent: Intent.Paste,
		mode: Mode.MOVE,
		action: () => {
			patchState({
				mode: Mode.DEFAULT,
			});
			return succeeded('Pasting item', null);
		},
	},
];
export const moveWithinParent: ActionEntry[] = [
	{
		intent: Intent.MovePreviousItem,
		mode: Mode.MOVE,
		action: () => moveChildWithinParent(-1),
	},
	{
		intent: Intent.MoveNextItem,
		mode: Mode.MOVE,
		action: () => moveChildWithinParent(1),
	},
];
export const moveAcrossParents: ActionEntry[] = [
	{
		intent: Intent.MoveToNextContainer,
		mode: Mode.MOVE,
		action: () => moveNodeToSiblingContainer(1),
	},
	{
		intent: Intent.MoveToPreviousContainer,
		mode: Mode.MOVE,
		action: () => moveNodeToSiblingContainer(-1),
	},
];
