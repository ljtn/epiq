import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {navigationState, patchState, updateState} from '../../state/state.js';
import {KeyIntent} from '../../utils/key-intent.js';
import {onConfirmCommandLineInput} from './input-actions-utils.js';
export const inputActions: ActionEntry[] = [
	{
		intent: KeyIntent.ToggleHelp,
		mode: Mode.HELP,
		action: () => {
			patchState({
				mode: Mode.DEFAULT,
			});
		},
	},
	{
		intent: KeyIntent.Confirm,
		mode: Mode.COMMAND_LINE,
		action: () => {
			onConfirmCommandLineInput(navigationState.commandLineInput);
		},
	},
	{
		intent: KeyIntent.CaptureInput,
		mode: Mode.COMMAND_LINE,
		action: (_1, _2, {sequence}) => {
			updateState(s => ({
				...s,
				commandLineInput: s.commandLineInput + sequence,
			}));
		},
	},
	{
		intent: KeyIntent.EraseInput,
		mode: Mode.COMMAND_LINE,
		action: () => {
			updateState(s => ({
				...s,
				commandLineInput: s.commandLineInput.slice(0, -1),
			}));
		},
	},
];
