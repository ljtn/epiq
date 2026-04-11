import os from 'node:os';
import path from 'node:path';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../command-line/command-types.js';
import {fileManager} from '../storage/file-manager.js';

export type EpiqConfig = {
	preferredEditor?: string;
};

const CONFIG_FILE_NAME = '.epiqrc';

export const getEpiqConfigPath = (): string =>
	path.join(os.homedir(), CONFIG_FILE_NAME);

const safeParseConfig = (raw: string): Result<EpiqConfig> => {
	try {
		const parsed = JSON.parse(raw) as EpiqConfig;
		return succeeded('Parsed config', parsed ?? {});
	} catch {
		return failed('Invalid ~/.epiqrc JSON');
	}
};

export const readEpiqConfig = (): Result<EpiqConfig> => {
	const configPath = getEpiqConfigPath();
	const raw = fileManager.readFile(configPath);

	if (raw == null || raw.trim() === '') {
		return succeeded('No config found, using empty config', {});
	}

	return safeParseConfig(raw);
};

export const writeEpiqConfig = (config: EpiqConfig): Result<null> => {
	const configPath = getEpiqConfigPath();

	try {
		fileManager.writeToFile(configPath, JSON.stringify(config, null, 2) + '\n');
		return succeeded('Config written', null);
	} catch {
		return failed('Unable to write ~/.epiqrc');
	}
};

export const setPreferredEditorConfig = (editor: string): Result<string> => {
	const existingResult = readEpiqConfig();
	if (isFail(existingResult)) return failed('Failed to set preferred editor');

	const nextConfig: EpiqConfig = {
		...existingResult.data,
		preferredEditor: editor,
	};

	return writeEpiqConfig(nextConfig);
};
