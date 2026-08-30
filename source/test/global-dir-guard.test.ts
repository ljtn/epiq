import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {getGlobalConfigDir} from '../lib/storage/global-config-dir.js';
import {assertGlobalDirThrowaway} from './setup/global-dir-in-tmp.js';

describe('global dir isolation', () => {
	it('defaults EPIQ_GLOBAL_DIR to a throwaway dir for the whole run', () => {
		const tempRoot = fs.realpathSync(os.tmpdir());

		expect(process.env['EPIQ_GLOBAL_DIR']).toBeTruthy();
		expect(getGlobalConfigDir().startsWith(tempRoot)).toBe(true);
	});

	it('accepts a dir under the temp root', () => {
		expect(() =>
			assertGlobalDirThrowaway(path.join(os.tmpdir(), 'epiq-global-x')),
		).not.toThrow();
	});

	it('refuses the real global dir', () => {
		expect(() =>
			assertGlobalDirThrowaway(path.join(os.homedir(), '.epiq-global')),
		).toThrow(/throwaway/);
	});

	it('refuses a missing dir outside tmp rather than allowing it', () => {
		expect(() =>
			assertGlobalDirThrowaway('/definitely/not/a/real/path/epiq-global'),
		).toThrow(/throwaway/);
	});
});
