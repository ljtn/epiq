import os from 'node:os';
import path from 'node:path';

export const GLOBAL_CONFIG_DIR_NAME = '.epiq-global';

/**
 * Where Epiq's global state (user config, worktrees) lives. Overridable via
 * `EPIQ_GLOBAL_DIR` so tests (and other embedders) can isolate it without
 * touching `HOME`, which git/ssh/npm also rely on.
 */
export const getGlobalConfigDir = (): string =>
	process.env['EPIQ_GLOBAL_DIR'] ??
	path.join(os.homedir(), GLOBAL_CONFIG_DIR_NAME);
