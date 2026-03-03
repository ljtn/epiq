import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {
	eraseInput,
	eraseInputWord,
	getNextCmd,
	getPrevCmd,
	moveCursorPosition,
	moveCursorPositionOfWord,
	setCmdInput,
} from '../../state/cmd.state.js';
import {patchState} from '../../state/state.js';
import {Intent} from '../../utils/key-intent.js';
import {findOverlap} from '../../utils/string.utils.js';
import {onConfirmCommandLineSequenceInput} from './on-cmd-input-confirm.js';
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
		intent: Intent.MoveCursorLeft,
		mode: Mode.COMMAND_LINE,
		action: () => {
			moveCursorPosition(-1);
		},
	},
	{
		intent: Intent.MoveCursorRight,
		mode: Mode.COMMAND_LINE,
		action: () => {
			moveCursorPosition(1);
		},
	},
	{
		intent: Intent.MoveCursorLeftOfWord,
		mode: Mode.COMMAND_LINE,
		action: () => moveCursorPositionOfWord('left'),
	},
	{
		intent: Intent.MoveCursorRightOfWord,
		mode: Mode.COMMAND_LINE,
		action: () => moveCursorPositionOfWord('right'),
	},
	{
		intent: Intent.ExitCommandLine,
		mode: Mode.COMMAND_LINE,
		action: () => {
			patchState({mode: Mode.DEFAULT});
		},
	},
	{
		intent: Intent.AutoCompleteCommand,
		mode: Mode.COMMAND_LINE,
		action: () => {
			setCmdInput((previousInput, hint) => {
				let lastWord = previousInput.split(' ').at(-1) || '';
				const overlap = findOverlap(lastWord, hint);
				return hint ? previousInput + hint.slice(overlap) : previousInput;
			});
		},
	},
	{
		intent: Intent.CaptureInput,
		mode: Mode.COMMAND_LINE,
		action: (_1, _2, {sequence}) => setCmdInput(s => s + sequence),
	},
	{
		intent: Intent.EraseInput,
		mode: Mode.COMMAND_LINE,
		action: () => eraseInput(),
	},
	{
		intent: Intent.EraseInputWord,
		mode: Mode.COMMAND_LINE,
		action: () => eraseInputWord(),
	},
	{
		intent: Intent.GetLastCommandFromHistory,
		mode: Mode.COMMAND_LINE,
		action: () => getPrevCmd(),
	},
	{
		intent: Intent.GetNextCommandFromHistory,
		mode: Mode.COMMAND_LINE,
		action: () => getNextCmd(),
	},
];
