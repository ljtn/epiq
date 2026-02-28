import os from 'node:os';
import path from 'node:path';
import stringify from 'json-stringify-pretty-compact';
import {fileManager} from './file-manager.js';

export type UserSettings = {
	editor?: string;
	defaultTheme?: 'dark' | 'light';
};

const DEFAULT_USER_SETTINGS: UserSettings = {
	editor: undefined,
	defaultTheme: 'dark',
};

export const userConfig = {
	rcPath() {
		return path.join(os.homedir(), '.epiqrc'); // JSON file
	},

	load(): UserSettings {
		const p = this.rcPath();
		if (!fileManager.fileExists?.(p)) {
			// If your fileManager doesn't have fileExists, readFile returning null works too.
			return DEFAULT_USER_SETTINGS;
		}

		try {
			const parsed = fileManager.readFileJSON<UserSettings>(p);
			return {...DEFAULT_USER_SETTINGS, ...(parsed ?? {})};
		} catch {
			// if corrupted, fail safe
			return DEFAULT_USER_SETTINGS;
		}
	},

	save(next: UserSettings) {
		const p = this.rcPath();
		fileManager.writeToFile(p, stringify(next, {maxLength: 1, indent: 2}));
	},
};
