import {nextSetupCommand} from '../config/setup-utils.js';
import {Mode} from '../model/action-map.model.js';
import {replaceCmdInput} from '../state/cmd.state.js';
import {getState, patchState} from '../state/state.js';

/**
 * After a setup answer: opens the next step already typed, or closes when done.
 * Not in setup-utils, which validation imports.
 */
export const advanceSetup = (): void => {
	const next = nextSetupCommand();

	// A command that opened a screen of its own keeps it. The board isn't a screen
	// (`:init` lands there), nor is the command line.
	const mode = getState().mode;
	if (mode !== Mode.COMMAND_LINE && mode !== Mode.DEFAULT) return;

	if (!next) {
		patchState({mode: Mode.DEFAULT});
		return;
	}

	patchState({mode: Mode.COMMAND_LINE});
	replaceCmdInput(next);
};
