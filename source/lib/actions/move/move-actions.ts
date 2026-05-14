import {failed} from '../../model/result-types.js';
import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {patchState} from '../../state/state.js';
import {Intent} from '../../utils/key-intent.js';
import {onConfirmCommandLineSequenceInput} from '../input/on-cmd-input-confirm.js';
import {getMovePendingState} from './move-actions-utils.js';
import {replaceCmdInput} from '../../state/cmd.state.js';

export const toggleMoveMode: ActionEntry[] = [
	{
		intent: Intent.Exit,
		mode: Mode.MOVE,
		description: '[<Esc>] exit context / cancel',
		action: () => {
			patchState({mode: Mode.COMMAND_LINE});
			replaceCmdInput(`move cancel`);
			return onConfirmCommandLineSequenceInput({isForceExecutedBySystem: true});
		},
	},
	{
		intent: Intent.InitMove,
		mode: Mode.DEFAULT,
		description: '[m] move (init/confirm)',
		action: () => {
			patchState({mode: Mode.COMMAND_LINE});
			replaceCmdInput(`move start`);
			return onConfirmCommandLineSequenceInput({isForceExecutedBySystem: true});
		},
	},
	{
		intent: Intent.ConfirmMove,
		mode: Mode.MOVE,
		action: () => {
			patchState({mode: Mode.COMMAND_LINE});
			replaceCmdInput(`move confirm`);
			return onConfirmCommandLineSequenceInput({isForceExecutedBySystem: true});
		},
	},
];

export const moveWithinParent: ActionEntry[] = [
	{
		intent: Intent.MovePreviousItem,
		mode: Mode.MOVE,
		action: () => {
			if (!getMovePendingState()) return failed('No pending move');
			patchState({mode: Mode.COMMAND_LINE});
			replaceCmdInput(`move previous`);
			return onConfirmCommandLineSequenceInput({isForceExecutedBySystem: true});
		},
	},
	{
		intent: Intent.MoveNextItem,
		mode: Mode.MOVE,
		action: () => {
			if (!getMovePendingState()) return failed('No pending move');
			patchState({mode: Mode.COMMAND_LINE});
			replaceCmdInput(`move next`);
			return onConfirmCommandLineSequenceInput({isForceExecutedBySystem: true});
		},
	},
];

export const moveAcrossParents: ActionEntry[] = [
	{
		intent: Intent.MoveToNextContainer,
		mode: Mode.MOVE,
		action: () => {
			if (!getMovePendingState()) return failed('No pending move');
			patchState({mode: Mode.COMMAND_LINE});
			replaceCmdInput(`move to-next`);
			return onConfirmCommandLineSequenceInput({isForceExecutedBySystem: true});
		},
	},
	{
		intent: Intent.MoveToPreviousContainer,
		mode: Mode.MOVE,
		action: () => {
			if (!getMovePendingState()) return failed('No pending move');
			patchState({mode: Mode.COMMAND_LINE});
			replaceCmdInput(`move to-previous`);
			return onConfirmCommandLineSequenceInput({isForceExecutedBySystem: true});
		},
	},
];
