import {hasPendingDefaultEvents} from '../../event/event-boot.js';
import {getSettingsState} from '../state/settings.state.js';

export const getUserSetupStatus = (): {
	hasPreferredEditor: boolean;
	hasUserName: boolean;
	userName: string | null;
	preferredEditor: string | null;
	isSetup: boolean;
} => {
	const settings = getSettingsState();
	const hasUserName = Boolean(settings.userName?.trim());
	const hasPreferredEditor = Boolean(settings.preferredEditor?.trim());
	return {
		isSetup: hasPreferredEditor && hasUserName,
		hasPreferredEditor,
		hasUserName,
		userName: settings.userName,
		preferredEditor: settings.preferredEditor,
	};
};
export const isRepositoryInitialized = () => {
	const hasPendingEvents = hasPendingDefaultEvents();
	const isConfigured = !hasPendingEvents;

	return isConfigured;
};
