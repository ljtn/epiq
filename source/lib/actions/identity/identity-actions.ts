import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {succeeded} from '../../model/result-types.js';
import {replaceCmdInput} from '../../state/cmd.state.js';
import {getOfferedEmails} from '../../state/email-offers.state.js';
import {patchState} from '../../state/state.js';
import {Intent} from '../../utils/key-intent.js';

// Read-only, so the only keys it needs are the ones that leave. Claiming and
// giving an address back are commands, which keeps the numbers on screen and
// the numbers the command counts the same thing.
const close = () => {
	replaceCmdInput('');
	patchState({mode: Mode.DEFAULT});
};

export const IdentityActions: ActionEntry[] = [
	{
		intent: Intent.Confirm,
		mode: Mode.IDENTITY,
		description: '[enter] claim the first',
		action: () => {
			const [first] = getOfferedEmails();

			if (!first) return succeeded('Nothing left to claim', null);

			// Prefilled rather than claimed outright. The address is usually the
			// right one and ENTER takes it, but a claim is permanent and the line
			// can be edited or another one typed over it first.
			patchState({mode: Mode.COMMAND_LINE});
			replaceCmdInput(`config emails ${first}`);

			return succeeded('Proposed claim', null);
		},
	},
	{
		intent: Intent.ExitCommandLine,
		mode: Mode.IDENTITY,
		action: () => {
			close();
			return succeeded('Closed identity', null);
		},
	},
	{
		intent: Intent.Exit,
		mode: Mode.IDENTITY,
		description: '[esc] close',
		action: () => {
			close();
			return succeeded('Closed identity', null);
		},
	},
];
