import {succeeded} from '../../model/result-types.js';
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
import {onConfirmCommandLineSequenceInput} from './on-cmd-input-confirm.js';
import {appendCommandInput} from '../../editor/inline-editor.js';
export const inputActions: ActionEntry[] = [
	{
		intent: Intent.ViewHelp,
		mode: Mode.DEFAULT,
		action: () => {
			patchState({mode: Mode.HELP});
			return succeeded('Viewing help', null);
		},
	},
	{
		intent: Intent.Exit,
		mode: Mode.HELP,
		action: () => {
			patchState({mode: Mode.DEFAULT});
			return succeeded('Exiting help', null);
		},
	},
	{
		intent: Intent.Confirm,
		mode: Mode.COMMAND_LINE,
		action: () => {
			onConfirmCommandLineSequenceInput();
			return succeeded('Executing command', null);
		},
	},
	{
		intent: Intent.MoveCursorLeft,
		mode: Mode.COMMAND_LINE,
		action: () => {
			moveCursorPosition(-1);
			return succeeded('Moving cursor left', null);
		},
	},
	{
		intent: Intent.MoveCursorRight,
		mode: Mode.COMMAND_LINE,
		action: () => {
			moveCursorPosition(1);
			return succeeded('Moving cursor right', null);
		},
	},
	{
		intent: Intent.MoveCursorLeftOfWord,
		mode: Mode.COMMAND_LINE,
		action: () => {
			moveCursorPositionOfWord('left');
			return succeeded('Moving cursor left of word', null);
		},
	},
	{
		intent: Intent.MoveCursorRightOfWord,
		mode: Mode.COMMAND_LINE,
		action: () => {
			moveCursorPositionOfWord('right');
			return succeeded('Moving cursor right of word', null);
		},
	},
	{
		intent: Intent.ExitCommandLine,
		mode: Mode.COMMAND_LINE,
		action: () => {
			patchState({mode: Mode.DEFAULT});
			return succeeded('Exiting command line', null);
		},
	},
	{
		intent: Intent.AutoCompleteCommand,
		mode: Mode.COMMAND_LINE,
		action: () => {
			setCmdInput((previousInput, {remainder}) => {
				return remainder ? previousInput + remainder : previousInput;
			});
			return succeeded('Auto-completing command', null);
		},
	},
	{
		intent: Intent.CaptureInput,
		mode: Mode.COMMAND_LINE,
		action: (_1, {sequence}) => {
			appendCommandInput(sequence ?? '');
			return succeeded('Capturing input', null);
		},
	},
	{
		intent: Intent.EraseInput,
		mode: Mode.COMMAND_LINE,
		action: () => {
			eraseInput();
			return succeeded('Erasing input', null);
		},
	},
	{
		intent: Intent.EraseInputWord,
		mode: Mode.COMMAND_LINE,
		action: () => {
			eraseInputWord();
			return succeeded('Erasing input word', null);
		},
	},
	{
		intent: Intent.GetLastCommandFromHistory,
		mode: Mode.COMMAND_LINE,
		action: () => {
			getPrevCmd();
			return succeeded('Getting last command from history', null);
		},
	},
	{
		intent: Intent.GetNextCommandFromHistory,
		mode: Mode.COMMAND_LINE,
		action: () => {
			getNextCmd();
			return succeeded('Getting next command from history', null);
		},
	},
];
