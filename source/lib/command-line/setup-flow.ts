import {nextSetupCommand} from '../config/setup-utils.js';
import {Mode} from '../model/action-map.model.js';
import {replaceCmdInput} from '../state/cmd.state.js';
import {patchState} from '../state/state.js';

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

	if (!next) {
		patchState({mode: Mode.DEFAULT});
		return;
	}

	patchState({mode: Mode.COMMAND_LINE});
	replaceCmdInput(next);
};
