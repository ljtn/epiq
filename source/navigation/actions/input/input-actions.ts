import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {
	getNextCommand,
	getPrevCommand,
	updateCommandLineInput,
} from '../../state/command-line.state.js';
import {patchState} from '../../state/state.js';
import {Intent} from '../../utils/key-intent.js';
import {onConfirmCommandLineSequenceInput} from './command-line-input.js';
export const inputActions: ActionEntry[] = [
	{
		intent: Intent.ViewHelp,
		mode: Mode.DEFAULT,
		action: () => patchState({mode: Mode.HELP}),
	},
	{
		intent: Intent.Exit,
		mode: Mode.HELP,
		action: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: Intent.Confirm,
		mode: Mode.COMMAND_LINE,
		action: (...args) => {
			onConfirmCommandLineSequenceInput(...args);
		},
	},
	{
		intent: Intent.CaptureInput,
		mode: Mode.COMMAND_LINE,
		action: (_1, _2, {sequence}) => updateCommandLineInput(s => s + sequence),
	},
	{
		intent: Intent.EraseInput,
		mode: Mode.COMMAND_LINE,
		action: () => updateCommandLineInput(s => s.slice(0, -1)),
	},
	{
		intent: Intent.GetLastCommandFromHistory,
		mode: Mode.COMMAND_LINE,
		action: () => getPrevCommand(),
	},
	{
		intent: Intent.GetNextCommandFromHistory,
		mode: Mode.COMMAND_LINE,
		action: () => getNextCommand(),
	},
];
