import os from 'node:os';
import path from 'node:path';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../command-line/command-types.js';
import {patchSettingsState} from '../state/settings.state.js';
import {fileManager} from '../storage/file-manager.js';

export const SYSTEM_USER = {
	userId: '',
	userName: '',
	preferredEditor: '',
};

export type EpiqConfig = {
	preferredEditor?: string;
	userName?: string;
	userId?: string;
};

const EPIQ_DIR_NAME = '.epiq';
const CONFIG_FILE_NAME = 'config.json';

export const getEpiqHomePath = (): string =>
	path.join(os.homedir(), EPIQ_DIR_NAME);

export const getEpiqConfigPath = (): string =>
	path.join(getEpiqHomePath(), CONFIG_FILE_NAME);

const ensureEpiqHomeExists = (): Result<null> => {
	try {
		fileManager.mkDir(getEpiqHomePath());
		return succeeded('Ensured ~/.epiq exists', null);
	} catch {
		return failed('Unable to create ~/.epiq');
	}
};

const safeParseConfig = (raw: string): Result<EpiqConfig> => {
	try {
		const parsed = JSON.parse(raw) as EpiqConfig;
		return succeeded('Parsed config', parsed ?? {});
	} catch {
		return failed('Invalid ~/.epiq/config.json JSON');
	}
};

export const readEpiqConfig = (): Result<EpiqConfig> => {
	const ensureResult = ensureEpiqHomeExists();
	if (isFail(ensureResult)) return failed(ensureResult.message);

	const configPath = getEpiqConfigPath();
	const raw = fileManager.readFile(configPath);

	if (raw == null || raw.trim() === '') {
		return succeeded('No config found, using empty config', {});
	}

	return safeParseConfig(raw);
};

export const writeEpiqConfig = (config: EpiqConfig): Result<null> => {
	const ensureResult = ensureEpiqHomeExists();
	if (isFail(ensureResult)) return failed(ensureResult.message);

	const configPath = getEpiqConfigPath();

	try {
		fileManager.writeToFile(configPath, JSON.stringify(config, null, 2) + '\n');
		return succeeded('Config written', null);
	} catch {
		return failed('Unable to write ~/.epiq/config.json');
	}
};

export const setConfig = (partialConfig: Partial<EpiqConfig>) => {
	const existingResult = readEpiqConfig();
	if (isFail(existingResult)) return failed('Failed to read existing config');

	const nextConfig: EpiqConfig = {
		...existingResult.data,
		...partialConfig,
	};

	return writeEpiqConfig(nextConfig);
};

export const loadSettingsFromConfig = () => {
	const configPath = getEpiqConfigPath();

	const ensureResult = ensureEpiqHomeExists();
	if (isFail(ensureResult)) {
		throw new Error('Unable to create ~/.epiq');
	}

	const exists = fileManager.readFile(configPath) !== null;

	if (!exists) {
		const createResult = writeEpiqConfig(SYSTEM_USER);
		if (isFail(createResult)) {
			throw new Error('Unable to create ~/.epiq/config.json');
		}
	}

	const result = readEpiqConfig();
	if (isFail(result)) {
		throw new Error('Unable to load settings');
	}

	const {preferredEditor, userName, userId} = result.data;

	if (!userName || !userId) {
		return failed('User name or ID not configured in ~/.epiq/config.json');
	}

	return patchSettingsState({
		preferredEditor,
		userName,
		userId,
	});
};
