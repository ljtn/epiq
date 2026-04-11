import {
	readEpiqConfig,
	writeEpiqConfig,
	getEpiqConfigPath,
} from './epiq-config.js';
import {patchSettingsState} from '../state/settings.state.js';
import {isFail} from '../command-line/command-types.js';
import {fileManager} from '../storage/file-manager.js';

export const loadSettingsFromConfig = (): void => {
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

	const defaultUser =
		process.env['GIT_AUTHOR_NAME'] ||
		process.env['GIT_COMMITTER_NAME'] ||
		process.env['USER'] ||
		process.env['USERNAME'] ||
		'UNKNOWN';

	// 3. Hydrate state
	patchSettingsState({
		preferredEditor: preferredEditor,
		userName: userName ?? defaultUser,
	});
};
