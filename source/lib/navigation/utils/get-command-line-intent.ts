import readline from 'readline';
import {Intent} from './key-intent.js';

export const getCommandLineIntent = (key: readline.Key, sequence: string) => {
	if (key.meta && key.name === 'b') {
		return Intent.MoveCursorLeftOfWord;
	}

	if (key.meta && key.name === 'f') {
		return Intent.MoveCursorRightOfWord;
	}

	if (key.ctrl && key.name === 'w') {
		return Intent.EraseInputWord;
	}

	switch (key.name) {
		case 'tab':
			return Intent.AutoCompleteCommand;
		case 'up':
			return Intent.GetLastCommandFromHistory;
		case 'down':
			return Intent.GetNextCommandFromHistory;
		case 'left':
			return Intent.MoveCursorLeft;
		case 'right':
			return Intent.MoveCursorRight;
		case 'return':
			return Intent.Confirm;
		case 'backspace':
			return sequence ? Intent.EraseInput : Intent.ExitCommandLine;
		case 'escape':
			return Intent.ExitCommandLine;
		default:
			return Intent.CaptureInput;
	}
};
