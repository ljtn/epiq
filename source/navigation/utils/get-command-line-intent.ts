import {KeyIntent} from './key-intent.js';
import readline from 'readline';

export const getCommandLineIntent = (key: readline.Key) => {
	switch (key.name) {
		case 'up':
			return KeyIntent.GetLastCommandFromHistory;
		case 'down':
			return KeyIntent.GetNextCommandFromHistory;
		case 'return':
			return KeyIntent.Confirm;
		case 'backspace':
			return KeyIntent.EraseInput;
		case 'escape':
			return KeyIntent.ToggleCommandLine;
		default:
			return KeyIntent.CaptureInput;
	}
};
