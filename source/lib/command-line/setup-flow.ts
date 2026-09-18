import {nextSetupCommand} from '../config/setup-utils.js';
import {Mode} from '../model/action-map.model.js';
import {replaceCmdInput} from '../state/cmd.state.js';
import {getState, patchState} from '../state/state.js';

/**
 * Where the command line goes after a setup answer lands.
 *
 * Mid-setup it opens the next step already typed, so the sequence is answered
 * rather than retyped — four `:config ` prefixes nobody chose. Afterwards it
 * closes, like every other command.
 *
 * Here rather than in `setup-utils`, which answers what is configured and is
 * read by the command line's own validation. Letting it reach into command
 * state put the whole state module in that graph.
 */
export const advanceSetup = (): void => {
	const next = nextSetupCommand();

	// A command that opened a screen of its own keeps it: `:config emails`
	// bare draws the addresses, and closing the line under it made the screen
	// appear and vanish. The board and the command line are not screens — one
	// is where a finished command leaves you, the other is where the next step
	// belongs — and `:init` lands on the board by rebuilding the whole state,
	// so treating that as a destination would end the sequence one step early.
	const mode = getState().mode;
	if (mode !== Mode.COMMAND_LINE && mode !== Mode.DEFAULT) return;

	if (!next) {
		patchState({mode: Mode.DEFAULT});
		return;
	}

	patchState({mode: Mode.COMMAND_LINE});
	replaceCmdInput(next);
};
