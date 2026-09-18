import {appendCommandInput} from '../../editor/inline-editor.js';
import {ActionEntry, Mode, ModeUnion} from '../../model/action-map.model.js';
import {succeeded} from '../../model/result-types.js';
import {
	eraseInput,
	eraseInputWord,
	getNextCmd,
	getPrevCmd,
	moveCursorPosition,
	moveCursorPositionOfWord,
	setCmdInput,
} from '../../state/cmd.state.js';
import {
	getHeldEmails,
	getOfferedEmails,
} from '../../state/email-offers.state.js';
import {getState, patchState} from '../../state/state.js';
import {CmdKeywords} from '../../command-line/cmd-keywords.js';
import {Intent} from '../../utils/key-intent.js';
import {onConfirmCommandLineSequenceInput} from './on-cmd-input-confirm.js';

const COMMAND_INPUT_MODES = [Mode.COMMAND_LINE, Mode.PALETTE];

/**
 * The value a completed command opens with, where there is an obvious one.
 *
 * Completion fills a half-typed word; this fills an empty argument, which is
 * the only way a whole value with a space in it can be offered at all. `edit
 * title` established it — the rest are the same idea.
 */
const prefillFor = (input: string): string => {
	if (input === 'edit title ') return getState().selectedNode?.title ?? '';

	// The likeliest address to claim, and the one to give back. Both lists are
	// whatever was last drawn, so the value offered is the one on screen.
	if (input === `${CmdKeywords.CONFIG} emails `) {
		return getOfferedEmails()[0] ?? '';
	}

	if (input === `${CmdKeywords.CONFIG} unclaim `) {
		return getHeldEmails()[0] ?? '';
	}

	return '';
};

const createCommandInputActions = (mode: ModeUnion): ActionEntry[] => [
	{
		intent: Intent.MoveCursorLeft,
		mode,
		action: () => {
			moveCursorPosition(-1);
			return succeeded('Moving cursor left', null);
		},
	},
	{
		intent: Intent.MoveCursorRight,
		mode,
		action: () => {
			moveCursorPosition(1);
			return succeeded('Moving cursor right', null);
		},
	},
	{
		intent: Intent.MoveCursorLeftOfWord,
		mode,
		action: () => {
			moveCursorPositionOfWord('left');
			return succeeded('Moving cursor left of word', null);
		},
	},
	{
		intent: Intent.MoveCursorRightOfWord,
		mode,
		action: () => {
			moveCursorPositionOfWord('right');
			return succeeded('Moving cursor right of word', null);
		},
	},
	{
		intent: Intent.AutoCompleteCommand,
		mode,
		action: () => {
			setCmdInput((previousInput, {remainder}) => {
				const newCompleteInput = remainder
					? previousInput + remainder
					: previousInput;

				return newCompleteInput + prefillFor(newCompleteInput);
			});

			return succeeded('Auto-completing command', null);
		},
	},
	{
		intent: Intent.CaptureInput,
		mode,
		action: (_1, {sequence}) => {
			appendCommandInput(sequence ?? '');
			return succeeded('Capturing input', null);
		},
	},
	{
		intent: Intent.EraseInput,
		mode,
		action: () => {
			eraseInput();
			return succeeded('Erasing input', null);
		},
	},
	{
		intent: Intent.EraseInputWord,
		mode,
		action: () => {
			eraseInputWord();
			return succeeded('Erasing input word', null);
		},
	},
];

export const inputActions: ActionEntry[] = [
	{
		intent: Intent.Confirm,
		mode: Mode.COMMAND_LINE,
		action: () => {
			void onConfirmCommandLineSequenceInput();
			return succeeded('Executing command', null);
		},
	},
	{
		intent: Intent.ViewHelp,
		mode: Mode.DEFAULT,
		action: () => {
			patchState({mode: Mode.HELP});
			return succeeded('Viewing help', null);
		},
	},

	...COMMAND_INPUT_MODES.flatMap(createCommandInputActions),

	{
		intent: Intent.ExitCommandLine,
		mode: Mode.COMMAND_LINE,
		action: () => {
			patchState({mode: Mode.DEFAULT});
			return succeeded('Exiting command line', null);
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
