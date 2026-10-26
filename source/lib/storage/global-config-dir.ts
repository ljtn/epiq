import os from 'node:os';
import path from 'node:path';

export const GLOBAL_CONFIG_DIR_NAME = '.epiq-global';

/** Where epiq's global state lives; `EPIQ_GLOBAL_DIR` isolates it without touching `HOME`. */
export const getGlobalConfigDir = (): string =>
	process.env['EPIQ_GLOBAL_DIR'] ??
	path.join(os.homedir(), GLOBAL_CONFIG_DIR_NAME);
