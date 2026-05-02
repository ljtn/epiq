import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {GLOBAL_CONFIG_DIR_NAME} from '../storage/paths.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {SettingsState} from '../state/settings.state.js';
import {fileManager} from '../storage/file-manager.js';

export const SYSTEM_USER: EpiqConfig = {
	userId: '',
	userName: '',
	preferredEditor: '',
	autoSync: false,
};

const EpiqConfigSchema = z
	.object({
		preferredEditor: z.string().optional(),
		userName: z.string().optional(),
		userId: z.string().optional(),
		autoSync: z.boolean().optional(),
	})
	.strict();

export type EpiqConfig = z.infer<typeof EpiqConfigSchema>;

const CONFIG_FILE_NAME = 'config.json';

export const getEpiqHomePath = (): string =>
	path.join(os.homedir(), GLOBAL_CONFIG_DIR_NAME);

export const getEpiqConfigPath = (): string =>
	path.join(getEpiqHomePath(), CONFIG_FILE_NAME);

const ensureEpiqHomeExists = (): Result<null> => {
	try {
		fileManager.mkDir(getEpiqHomePath());
		return succeeded(`Ensured ~/${GLOBAL_CONFIG_DIR_NAME} exists`, null);
	} catch {
		return failed(`Unable to create ~/${GLOBAL_CONFIG_DIR_NAME}`);
	}
};

const safeParseConfig = (raw: string): Result<EpiqConfig> => {
	let parsed: unknown;

	try {
		parsed = JSON.parse(raw);
	} catch {
		return failed(`Invalid ~/${GLOBAL_CONFIG_DIR_NAME}/config.json JSON`);
	}

	const result = EpiqConfigSchema.safeParse(parsed ?? {});

	if (!result.success) {
		return failed(
			`Invalid ~/${GLOBAL_CONFIG_DIR_NAME}/config.json shape: ${result.error.issues
				.map(issue => issue.path.join('.') || issue.message)
				.join(', ')}`,
		);
	}

	return succeeded('Parsed config', result.data);
};

export const readEpiqConfig = (): Result<EpiqConfig> => {
	const ensureResult = ensureEpiqHomeExists();
	if (isFail(ensureResult)) return failed(ensureResult.message);

	const configPath = getEpiqConfigPath();
	const raw = fileManager.readFile(configPath);

	if (raw == null || raw.trim() === '') {
		return succeeded('No config found, using empty config', {
			autoSync: false,
			preferredEditor: '',
			userId: '',
			userName: '',
		});
	}

	return safeParseConfig(raw);
};

export const writeEpiqConfig = (config: EpiqConfig): Result<null> => {
	const ensureResult = ensureEpiqHomeExists();
	if (isFail(ensureResult)) return failed(ensureResult.message);

	const result = EpiqConfigSchema.safeParse(config);

	if (!result.success) {
		return failed(
			`Invalid config: ${result.error.issues
				.map(issue => issue.path.join('.') || issue.message)
				.join(', ')}`,
		);
	}

	const configPath = getEpiqConfigPath();

	try {
		fileManager.writeToFile(
			configPath,
			JSON.stringify(result.data, null, 2) + '\n',
		);
		return succeeded('Config written', null);
	} catch {
		return failed(`Unable to write ~/${GLOBAL_CONFIG_DIR_NAME}/config.json`);
	}
};

export const setConfig = (partialConfig: Partial<EpiqConfig>) => {
	const existingResult = readEpiqConfig();
	if (isFail(existingResult)) return failed('Failed to read existing config');

	const nextConfig: EpiqConfig = {
		...existingResult.value,
		...partialConfig,
	};

	return writeEpiqConfig(nextConfig);
};

export const loadSettingsFromConfig = (): Result<SettingsState> => {
	const configPath = getEpiqConfigPath();

	const ensureResult = ensureEpiqHomeExists();
	if (isFail(ensureResult)) {
		return failed(`Unable to create ~/${GLOBAL_CONFIG_DIR_NAME}`);
	}

	const exists = fileManager.readFile(configPath) !== null;

	if (!exists) {
		const createResult = writeEpiqConfig(SYSTEM_USER);
		if (isFail(createResult)) {
			throw new Error(
				`Unable to create ~/${GLOBAL_CONFIG_DIR_NAME}/config.json`,
			);
		}
	}

	const result = readEpiqConfig();
	if (isFail(result)) {
		throw new Error(result.message || 'Unable to load settings');
	}

	const {preferredEditor, userName, userId, autoSync} = result.value;

	if (!userName || !userId) {
		return failed(
			`User name or ID not configured in ~/${GLOBAL_CONFIG_DIR_NAME}/config.json`,
		);
	}

	return succeeded('successfully loaded settings', {
		preferredEditor: preferredEditor ?? '',
		userName,
		userId,
		autoSync: autoSync ?? false,
	});
};
