import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {
	getNextCommand,
	getPrevCommand,
	updateCommandLineInput,
} from '../../state/command-line.state.js';
import {patchState} from '../../state/state.js';
import {KeyIntent} from '../../utils/key-intent.js';
import {onConfirmCommandLineSequenceInput} from './command-line-input.js';
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
		action: (...args) => {
			onConfirmCommandLineSequenceInput(...args);
		},
	},
	{
		intent: KeyIntent.CaptureInput,
		mode: Mode.COMMAND_LINE,
		action: (_1, _2, {sequence}) => updateCommandLineInput(s => s + sequence),
	},
	{
		intent: KeyIntent.EraseInput,
		mode: Mode.COMMAND_LINE,
		action: () => updateCommandLineInput(s => s.slice(0, -1)),
	},
	{
		intent: KeyIntent.GetLastCommandFromHistory,
		mode: Mode.COMMAND_LINE,
		action: () => getPrevCommand(),
	},
	{
		intent: KeyIntent.GetNextCommandFromHistory,
		mode: Mode.COMMAND_LINE,
		action: () => getNextCommand(),
	},
];
