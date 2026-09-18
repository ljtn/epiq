import {useSyncExternalStore} from 'react';
import {ViewMode} from '../model/app-state.model.js';

export type User = {
	userId: string;
	userName: string;
};

export type LogLevel = 'info' | 'error' | 'debug';

export type SettingsState = {
	logLevel: LogLevel;
	autoSyncIntervalMs: number | null;
	attachmentMaxKb: number | null;
	autoSync: boolean | null;
	preferredEditor: string | null;
	userName: string | null;
	userId: string | null;
	/**
	 * This repository's git `user.email`, read once at boot. Here rather than
	 * read on demand because the write path consults it on every write.
	 */
	gitEmail: string | null;
	/** This repository's git `user.name`, for proposing a board name. */
	gitName: string | null;
	/** Whether this machine has been asked about its git addresses. */
	emailSetup: 'linked' | 'declined' | null;
	viewMode: ViewMode | null;
};

let settingsState: SettingsState = {
	logLevel: 'info',
	autoSyncIntervalMs: null,
	attachmentMaxKb: null,
	autoSync: null,
	preferredEditor: null,
	userName: null,
	userId: null,
	gitEmail: null,
	gitName: null,
	emailSetup: null,
	viewMode: null,
};

const listeners = new Set<() => void>();

const emit = () => {
	for (const listener of listeners) {
		listener();
	}
};

export const getSettingsState = (): SettingsState => settingsState;

export const useSettingsState = (): SettingsState =>
	useSyncExternalStore(
		callback => {
			listeners.add(callback);

			return () => {
				listeners.delete(callback);
			};
		},
		() => settingsState,
	);

export const patchSettingsState = (
	patch: Partial<SettingsState>,
): SettingsState => {
	settingsState = {
		...settingsState,
		...patch,
	};

	emit();

	return settingsState;
};
