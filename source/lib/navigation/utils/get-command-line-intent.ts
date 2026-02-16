import {Intent} from './key-intent.js';
import readline from 'readline';

export const getCommandLineIntent = (key: readline.Key) => {
	switch (key.name) {
		case 'backspace':
			return Intent.ExitCommandLine;
		case 'up':
			return Intent.GetLastCommandFromHistory;
		case 'down':
			return Intent.GetNextCommandFromHistory;
		case 'return':
			return Intent.Confirm;
		case 'backspace':
			return Intent.EraseInput;
		case 'escape':
			return Intent.ToggleCommandLine;
		default:
			return Intent.CaptureInput;
	}
};
