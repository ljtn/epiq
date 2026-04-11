export type SettingsState = {
	preferredEditor: string | null;
};

let settingsState: SettingsState = {
	preferredEditor: null,
};

export const getSettingsState = (): SettingsState => settingsState;

export const patchSettingsState = (
	patch: Partial<SettingsState>,
): SettingsState => {
	settingsState = {
		...settingsState,
		...patch,
	};
	return settingsState;
};

export const resetSettingsState = (): void => {
	settingsState = {
		preferredEditor: null,
	};
};
