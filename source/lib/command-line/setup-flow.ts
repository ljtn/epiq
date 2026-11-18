import {machineStepCommand, nextSetupCommand} from '../config/setup-utils.js';
import {ACTOR_NAME_ENV} from '../config/actor-env.js';
import {Mode} from '../model/action-map.model.js';
import {replaceCmdInput} from '../state/cmd.state.js';
import {
	getSetupSession,
	MACHINE_STEPS,
	MachineStep,
	patchSetupSession,
} from '../state/setup-session.state.js';
import {getState, patchState} from '../state/state.js';
import {CmdIntent} from './command-intent.js';
import {ConfigModifiers} from './command-modifiers.js';

// Setup is this machine's and ends with its own questions. What a folder needs
// next (a board, a claim) is the folder's to offer.

const openLine = (command: string) => {
	patchState({mode: Mode.COMMAND_LINE});
	replaceCmdInput(command);
};

// Read at call time: command-modifiers sits in an import cycle with this module.
const stepOfModifier = (modifier: string): MachineStep | undefined =>
	((
		{
			[ConfigModifiers.USERNAME.toLowerCase()]: 'username',
			[ConfigModifiers.EDITOR.toLowerCase()]: 'editor',
			[ConfigModifiers.AUTOSYNC.toLowerCase()]: 'autoSync',
		} as Record<string, MachineStep>
	)[modifier.toLowerCase()]);

// The machine step the last successful `config` answered, for `advanceSetup`.
let answeredStep: MachineStep | undefined;

/** After a `config` command succeeds, before its `onSuccess`. */
export const noteConfigAnswered = (modifier: string): void => {
	answeredStep = stepOfModifier(modifier);
};

/**
 * `:setup`: the machine questions again, each holding its current answer. Not
 * the name while `EPIQ_USER_NAME` names this process: `config` refuses to change it.
 */
export const startSetupRerun = (): void => {
	patchSetupSession({
		rerunStep: process.env[ACTOR_NAME_ENV] ? 'editor' : MACHINE_STEPS[0],
	});
};

/** Opens the step a rerun is on; after `commandConfirmed`, which clears the line. */
export const openSetupRerunStep = (): void => {
	const {rerunStep} = getSetupSession();
	if (rerunStep) openLine(machineStepCommand(rerunStep));
};

/** Esc, or any command but `config`: the rerun ends, the answers given so far stand. */
export const leaveSetupRerun = (): void => {
	if (getSetupSession().rerunStep) patchSetupSession({rerunStep: undefined});
};

/** Before a confirmed command runs: only an answer keeps a rerun going. */
export const leaveSetupRerunFor = (intent: string): void => {
	if (intent !== CmdIntent.Config) leaveSetupRerun();
};

/**
 * After a `config` command: in setup, opens the next step already typed;
 * otherwise closes the line. Not in setup-utils, which validation imports.
 */
export const advanceSetup = (): void => {
	const answered = answeredStep;
	answeredStep = undefined;

	// A command that opened a screen of its own keeps it. The board isn't a screen
	// (`:init` lands there), nor is the command line.
	const mode = getState().mode;
	if (mode !== Mode.COMMAND_LINE && mode !== Mode.DEFAULT) return;

	const {rerunStep} = getSetupSession();

	if (rerunStep) {
		// Another setting than the one asked: the rerun ends rather than skip it.
		const next =
			answered === rerunStep
				? MACHINE_STEPS[MACHINE_STEPS.indexOf(rerunStep) + 1]
				: undefined;
		patchSetupSession({rerunStep: next});
		if (next) {
			openLine(machineStepCommand(next));
			return;
		}
	}

	const next = nextSetupCommand();
	if (next) {
		openLine(next);
		return;
	}

	patchState({mode: Mode.DEFAULT});
};
