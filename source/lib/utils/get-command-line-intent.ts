import readline from 'readline';
import {Intent} from './key-intent.js';

const isEraseWord = (key: readline.Key, sequence: string) =>
	(key.ctrl && key.name === 'w') ||
	(key.meta && key.name === 'backspace') ||
	sequence === '\x17';

const isMoveWordLeft = (key: readline.Key, sequence: string) =>
	(key.meta && key.name === 'b') || sequence === '\x1bb';

const isMoveWordRight = (key: readline.Key, sequence: string) =>
	(key.meta && key.name === 'f') || sequence === '\x1bf';

export const getCommandLineIntent = (key: readline.Key, sequence: string) => {
	if (isMoveWordLeft(key, key.sequence!)) {
		return Intent.MoveCursorLeftOfWord;
	}

	if (isMoveWordRight(key, key.sequence!)) {
		return Intent.MoveCursorRightOfWord;
	}

	if (isEraseWord(key, key.sequence!)) {
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
