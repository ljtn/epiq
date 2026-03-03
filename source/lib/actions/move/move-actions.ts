import {ActionEntry, Mode} from '../../model/action-map.model.js';
// import {setCmdInput} from '../../state/cmd.state.js';
import {getState, patchState} from '../../state/state.js';
import {Intent} from '../../utils/key-intent.js';
import {
	moveChildWithinParent,
	moveNodeToSiblingContainer,
} from './move-actions-utils.js';

export const toggleMoveMode: ActionEntry[] = [
	// Revisit. Perhaps implement an operator input state for this in vim style. For now restrict delete to command line
	// {
	// 	intent: Intent.Delete,
	// 	mode: Mode.MOVE,
	// 	description: '[d] delete',
	// 	action: () => {
	// 		patchState({mode: Mode.COMMAND_LINE});
	// 		setCmdInput(() => 'delete ', 'confirm');
	// 	},
	// },
	{
		// Reconsider. We should probably not move before confirm (paste)
		intent: Intent.Exit,
		mode: Mode.MOVE,
		description: '[esc] paste',
		action: () => {
			patchState({
				mode: Mode.DEFAULT,
			});
		},
	},
	{
		intent: Intent.Cut,
		mode: Mode.DEFAULT,
		description: '[d] cut',
		action: () => {
			logger.info('HERE WE GO', getState().selectedIndex);
			if (getState().selectedIndex === -1) return; // Block move if no children
			patchState({
				mode: Mode.MOVE,
			});
		},
	},
	{
		intent: Intent.Paste,
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
