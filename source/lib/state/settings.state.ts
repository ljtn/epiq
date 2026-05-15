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
	autoSync: boolean | null;
	preferredEditor: string | null;
	userName: string | null;
	userId: string | null;
	viewMode: ViewMode | null;
};

let settingsState: SettingsState = {
	logLevel: 'info',
	autoSyncIntervalMs: null,
	autoSync: null,
	preferredEditor: null,
	userName: null,
	userId: null,
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
