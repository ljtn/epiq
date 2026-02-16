import {Intent} from './key-intent.js';
import readline from 'readline';

export const getCommandLineIntent = (key: readline.Key, sequence: string) => {
	switch (key.name) {
		case 'tab':
			return Intent.AutoCompleteCommand;
		case 'up':
			return Intent.GetLastCommandFromHistory;
		case 'down':
			return Intent.GetNextCommandFromHistory;
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
