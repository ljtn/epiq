import {isFail, isSuccess} from '../model/result-types.js';
import {readProjectFile} from '../project-setup/project-setup.js';
import {getSettingsState} from '../state/settings.state.js';
import {resolveClosestEpiqProjectRoot} from '../storage/paths.js';

export const getUserSetupStatus = (): {
	isSetupDone: boolean;
	isSetPreferredEditor: boolean;
	isSetUserName: boolean;
	isSetAutoSync: boolean;
	isSetEmails: boolean;
	emailSetup: 'linked' | 'declined' | null;
	userName: string | null;
	preferredEditor: string | null;
	autoSync: boolean | null;
} => {
	const settings = getSettingsState();
	const isSetUserName = Boolean(settings.userName?.trim());
	const isSetPreferredEditor = Boolean(settings.preferredEditor?.trim());
	const isSetAutoSync =
		settings.autoSync === true || settings.autoSync === false;

	// Asked, not answered a particular way: declining counts. Nothing links
	// itself any more, so without a step here a person would never be told that
	// their commits are showing a git name rather than their board name.
	//
	// Only once there is a project to ask about. The other three answers are
	// facts about this machine and can be given before any board exists; this
	// one offers the addresses in a repository's own history, so it has nothing
	// to show until `:init` has run. It is also what makes the step appear again
	// for somebody already set up, which is the whole prompt.
	const isSetEmails =
		settings.emailSetup !== null || !isRepositoryInitialized();

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
		emailSetup: settings.emailSetup,
	};
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
