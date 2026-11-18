import {getSetupSession} from '../state/setup-session.state.js';
import {isValidEmail} from '../model/email-link.js';
import {isValidUserName} from './actor-env.js';
import {isFail, isSuccess} from '../model/result-types.js';
import {
	readProjectFile,
	readProjectId,
} from '../project-setup/project-setup.js';
import {getSettingsState} from '../state/settings.state.js';
import {claimedEmailsOf} from '../state/email-claims.state.js';
import {getOfferedEmails} from '../state/email-offers.state.js';
import {resolveClosestEpiqProjectRoot} from '../storage/paths.js';
import type {MachineStep} from '../state/setup-session.state.js';

export const getUserSetupStatus = (): {
	isSetupDone: boolean;
	/** The machine's own questions, whatever the board here still asks. */
	isMachineSetupDone: boolean;
	isSetUserName: boolean;
	isSetAutoSync: boolean;
	isSetEmails: boolean;
	claimedEmails: string[];
	/** So the screen can tell "claimed nothing" from "refused". */
	emailSetupDeclined: boolean;
	userName: string | null;
	autoSync: boolean | null;
} => {
	const settings = getSettingsState();
	const isSetUserName = Boolean(settings.userName?.trim());
	const isSetAutoSync =
		settings.autoSync === true || settings.autoSync === false;

	// Answered by a claim on the board's log, or declined; asked only once a
	// project exists. Claims first, since they need no disk read.
	const claimedEmails = claimedEmailsForUser();
	const boardId = claimedEmails.length > 0 ? null : currentBoardId();

	const declined =
		boardId !== null && (settings.declinedEmailBoards ?? []).includes(boardId);

	const isSetEmails = claimedEmails.length > 0 || declined || boardId === null;

	return {
		isSetupDone: isSetUserName && isSetAutoSync && isSetEmails,
		isMachineSetupDone: isSetUserName && isSetAutoSync,
		isSetUserName,
		userName: settings.userName,
		autoSync: settings.autoSync === undefined ? null : settings.autoSync,
		isSetAutoSync: isSetAutoSync,
		isSetEmails,
		claimedEmails,
		emailSetupDeclined: declined,
	};
};

/** The id of the board this process is looking at, or null outside one. */
export const currentBoardId = (): string | null => {
	const repoRootResult = resolveClosestEpiqProjectRoot(process.cwd());
	if (isFail(repoRootResult)) return null;

	const projectIdResult = readProjectId(repoRootResult.value);
	if (isFail(projectIdResult)) return null;

	// Never key a decline on `undefined`: it would silence every such repository.
	return projectIdResult.value || null;
};

const claimedEmailsForUser = (): string[] => {
	const {userId} = getSettingsState();

	return userId ? claimedEmailsOf(userId) : [];
};

export const hasClaimedAnEmail = (): boolean =>
	claimedEmailsForUser().length > 0;

/** Whether this machine declined the question on this board; a refusal is per board. */
export const isEmailSetupDeclined = (): boolean => {
	const boardId = currentBoardId();
	if (!boardId) return false;

	// Defaulted: some settings stores lack this field, and throwing here stops the TUI booting.
	const {declinedEmailBoards} = getSettingsState();

	return (declinedEmailBoards ?? []).includes(boardId);
};
export const isRepositoryInitialized = () => {
	const repoRootResult = resolveClosestEpiqProjectRoot(process.cwd());
	if (isFail(repoRootResult)) return false;

	const projectFileResult = readProjectFile(repoRootResult.value);

	return isSuccess(projectFileResult);
};

export type YesNo = 'on' | 'off';

export const booleanToYesNo = (
	value: boolean | null | undefined,
): YesNo | null => {
	if (value === true) return 'on';
	if (value === false) return 'off';

	return null;
};

export const yesNoToBoolean = (
	value: YesNo | null | undefined,
): boolean | null => {
	if (value === 'on') return true;
	if (value === 'off') return false;

	return null;
};

/**
 * The setup command to open next, so answering one step opens the next; null
 * once setup is done, when `:config` is an ordinary command again. Never `init`:
 * setup is this machine's, a project is the repository's.
 */
export const nextSetupCommand = (): string | null => {
	const status = getUserSetupStatus();

	// Proposed from git, so enter is enough; the line shows it to change first.
	if (!status.isSetUserName) {
		const {gitName} = getSettingsState();
		return `config username ${
			gitName && isValidUserName(gitName) ? gitName.trim() : ''
		}`;
	}
	// On by default: enter keeps the board current without a manual sync.
	if (!status.isSetAutoSync) return 'config autoSync on';

	// Seeded with the first scanned address, else git's `user.email`, since the
	// scan may not have run yet.
	if (!status.isSetEmails) {
		const {gitEmail} = getSettingsState();
		const suggestion = getOfferedEmails()[0] ?? gitEmail;

		// Validated: a git `user.email` is whatever the machine says.
		return suggestion && isValidEmail(suggestion)
			? `config emails ${suggestion}`
			: 'config emails ';
	}

	return null;
};

/** A machine step's command, holding the current answer, for a rerun to confirm or change. */
export const machineStepCommand = (step: MachineStep): string => {
	const {userName, autoSync} = getSettingsState();

	switch (step) {
		case 'username':
			return `config username ${userName ?? ''}`;
		case 'autoSync':
			return `config autoSync ${booleanToYesNo(autoSync) ?? ''}`;
	}
};

/** `epiq setup` has nothing left to ask: its success screen shows. */
export const isSetupFinished = (): boolean => {
	const {quitWhenDone, rerunStep} = getSetupSession();
	return (
		Boolean(quitWhenDone) &&
		!rerunStep &&
		getUserSetupStatus().isMachineSetupDone
	);
};
