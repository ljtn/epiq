import {
	getUserSetupStatus,
	isRepositoryInitialized,
	machineStepCommand,
	nextSetupCommand,
} from '../config/setup-utils.js';
import {Mode} from '../model/action-map.model.js';
import {replaceCmdInput} from '../state/cmd.state.js';
import {
	getSetupSession,
	MACHINE_STEPS,
	patchSetupSession,
} from '../state/setup-session.state.js';
import {getState, patchState} from '../state/state.js';
import {isInsideGitRepository} from '../storage/paths.js';

const openLine = (command: string) => {
	patchState({mode: Mode.COMMAND_LINE});
	replaceCmdInput(command);
};

/** Before a setup answer is applied: finishing setup with it hands over. */
export const noteSetupAnswer = (): void => {
	if (!getUserSetupStatus().isSetupDone) patchSetupSession({inProgress: true});
};

/** `:setup`: the machine questions again, each holding its current answer. */
export const startSetupRerun = (): void => {
	patchSetupSession({
		rerunStep: MACHINE_STEPS[0],
		inProgress: true,
		justCompleted: false,
	});
};

/** Opens the step a rerun is on; after `commandConfirmed`, which clears the line. */
export const openSetupRerunStep = (): void => {
	const {rerunStep} = getSetupSession();
	if (rerunStep) openLine(machineStepCommand(rerunStep));
};

/** Esc out of a rerun: the answers given so far stand. */
export const leaveSetupRerun = (): void => {
	if (getSetupSession().rerunStep) {
		patchSetupSession({rerunStep: undefined, inProgress: false});
	}
};

/**
 * Setup is done. A git repository with no board is asked whether to start one,
 * `init` already typed; anywhere else the screen says what is next.
 */
const handOver = (): void => {
	patchSetupSession({inProgress: false, justCompleted: true});

	if (!isRepositoryInitialized() && isInsideGitRepository(process.cwd())) {
		openLine('init');
		return;
	}

	patchState({mode: Mode.DEFAULT});
};

/**
 * After a setup answer: opens the next step already typed, hands over when that
 * was the last, or closes the line. Not in setup-utils, which validation imports.
 */
export const advanceSetup = (): void => {
	// A command that opened a screen of its own keeps it. The board isn't a screen
	// (`:init` lands there), nor is the command line.
	const mode = getState().mode;
	if (mode !== Mode.COMMAND_LINE && mode !== Mode.DEFAULT) return;

	const {rerunStep, inProgress} = getSetupSession();

	if (rerunStep) {
		const next = MACHINE_STEPS[MACHINE_STEPS.indexOf(rerunStep) + 1];
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

	if (inProgress) {
		handOver();
		return;
	}

	patchState({mode: Mode.DEFAULT});
};
