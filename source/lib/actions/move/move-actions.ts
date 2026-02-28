import {ActionEntry, Mode} from '../../navigation/model/action-map.model.js';
import {appState, patchState} from '../../navigation/state/state.js';
import {Intent} from '../../navigation/utils/key-intent.js';
import {
	moveChildWithinParent,
	moveNodeToSiblingContainer,
} from './move-actions-utils.js';

export const toggleMoveMode: ActionEntry[] = [
	{
		intent: Intent.Exit,
		mode: Mode.MOVE,
		description: '[d] paste',
		action: () => {
			patchState({
				mode: Mode.DEFAULT,
			});
		},
	},
	{
		intent: Intent.InitMove,
		mode: Mode.DEFAULT,
		description: '[d] cut',
		action: () => {
			if (appState.selectedIndex === -1) return; // Block move if no children
			patchState({
				mode: Mode.MOVE,
			});
		},
	},
	{
		intent: Intent.InitMove,
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
