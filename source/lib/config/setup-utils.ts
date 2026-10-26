import {isValidEmail} from '../model/email-link.js';
import {isFail, isSuccess} from '../model/result-types.js';
import {
	readProjectFile,
	readProjectId,
} from '../project-setup/project-setup.js';
import {getSettingsState} from '../state/settings.state.js';
import {claimedEmailsOf} from '../state/email-claims.state.js';
import {getOfferedEmails} from '../state/email-offers.state.js';
import {resolveClosestEpiqProjectRoot} from '../storage/paths.js';

export const getUserSetupStatus = (): {
	isSetupDone: boolean;
	isSetPreferredEditor: boolean;
	isSetUserName: boolean;
	isSetAutoSync: boolean;
	isSetEmails: boolean;
	claimedEmails: string[];
	/** So the screen can tell "claimed nothing" from "refused". */
	emailSetupDeclined: boolean;
	userName: string | null;
	preferredEditor: string | null;
	autoSync: boolean | null;
} => {
	const settings = getSettingsState();
	const isSetUserName = Boolean(settings.userName?.trim());
	const isSetPreferredEditor = Boolean(settings.preferredEditor?.trim());
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
		isSetupDone:
			isSetPreferredEditor && isSetUserName && isSetAutoSync && isSetEmails,
		isSetPreferredEditor,
		isSetUserName,
		userName: settings.userName,
		preferredEditor: settings.preferredEditor,
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
 * once setup is done, when `:config` is an ordinary command again.
 */
export const nextSetupCommand = (): string | null => {
	const status = getUserSetupStatus();

	if (!status.isSetUserName) return 'config username ';
	if (!status.isSetPreferredEditor) return 'config editor ';
	if (!status.isSetAutoSync) return 'config autoSync ';
	if (!isRepositoryInitialized()) return 'init';

	// Seeded with git's `user.email` for this repository, known at boot.
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
