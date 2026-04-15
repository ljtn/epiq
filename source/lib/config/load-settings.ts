import {isFail} from '../command-line/command-types.js';
import {patchSettingsState} from '../state/settings.state.js';
import {fileManager} from '../storage/file-manager.js';
import {
	getEpiqConfigPath,
	readEpiqConfig,
	writeEpiqConfig,
} from './epiq-config.js';

export const loadSettingsFromConfig = () => {
	const configPath = getEpiqConfigPath();

	// 1. Ensure file exists
	const exists = fileManager.readFile(configPath) !== null;

	if (!exists) {
		// create empty config
		const createResult = writeEpiqConfig({});
		if (isFail(createResult)) {
			throw new Error('Unable to create ~/.epiqrc');
		}
	}

	// 2. Read config
	const result = readEpiqConfig();
	if (isFail(result)) {
		throw new Error('Unable to load settings');
	}

	const {preferredEditor, userName} = result.data;

	// 3. Hydrate state
	patchSettingsState({
		preferredEditor: preferredEditor,
		userName: userName,
	});
};
