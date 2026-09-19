// The auto sync preference as the identity panel and `:config` both change
// it: what it refuses, what it leaves alone, and what an unset interval means.
//
// Against a real config file in a temp global dir, because the whole point of
// the module is the round trip through one — a mocked file manager would pin
// the calls rather than the file that survives a restart.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	DEFAULT_AUTO_SYNC_INTERVAL_MS,
	MIN_AUTO_SYNC_INTERVAL_MS,
} from '../lib/config/auto-sync-interval.js';
import {
	autoSyncBlockedReason,
	readAutoSyncSettings,
	writeAutoSyncSettings,
} from '../lib/config/sync-settings.js';
import {getEpiqConfigPath, setConfig} from '../lib/config/user-config.js';
import {isFail, isSuccess} from '../lib/model/result-types.js';
import {patchSettingsState} from '../lib/state/settings.state.js';

let originalGlobalDir: string | undefined;
let tempDir = '';

const configOnDisk = () =>
	JSON.parse(fs.readFileSync(getEpiqConfigPath(), 'utf8'));

beforeEach(() => {
	originalGlobalDir = process.env['EPIQ_GLOBAL_DIR'];
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-sync-settings-'));
	process.env['EPIQ_GLOBAL_DIR'] = path.join(tempDir, '.epiq-global');

	// A complete identity, so nothing is blocked unless a test blocks it.
	setConfig({
		logLevel: 'info',
		userId: '01HQZZZZZZZZZZZZZZZZZZZZZZ',
		userName: 'jola',
		preferredEditor: 'vim',
	});
	patchSettingsState({userName: 'jola', preferredEditor: 'vim'});
});

afterEach(() => {
	if (originalGlobalDir === undefined) delete process.env['EPIQ_GLOBAL_DIR'];
	else process.env['EPIQ_GLOBAL_DIR'] = originalGlobalDir;

	fs.rmSync(tempDir, {recursive: true, force: true});
});

describe('readAutoSyncSettings', () => {
	it('reads an unset interval as the one default', () => {
		const result = readAutoSyncSettings();

		expect(isSuccess(result)).toBe(true);
		if (isFail(result)) return;

		expect(result.value.enabled).toBe(false);
		expect(result.value.intervalMs).toBe(DEFAULT_AUTO_SYNC_INTERVAL_MS);
	});
});

describe('writeAutoSyncSettings', () => {
	it('refuses an interval under the floor, and writes nothing', () => {
		const result = writeAutoSyncSettings({
			intervalMs: MIN_AUTO_SYNC_INTERVAL_MS - 1,
		});

		expect(isFail(result)).toBe(true);
		expect(configOnDisk().autoSyncDebounceMs).toBeUndefined();
	});

	it('refuses a fraction of a millisecond', () => {
		expect(isFail(writeAutoSyncSettings({intervalMs: 3000.5}))).toBe(true);
	});

	it('takes the floor itself', () => {
		const result = writeAutoSyncSettings({
			intervalMs: MIN_AUTO_SYNC_INTERVAL_MS,
		});

		expect(isSuccess(result)).toBe(true);
		expect(configOnDisk().autoSyncDebounceMs).toBe(MIN_AUTO_SYNC_INTERVAL_MS);
	});

	// The panel's toggle and its interval field are two controls over one file.
	// A write that carried both would have each of them overwriting whatever
	// the other had just done.
	it('changes only what it was given', () => {
		writeAutoSyncSettings({intervalMs: 45_000});
		writeAutoSyncSettings({enabled: true});

		const result = readAutoSyncSettings();
		if (isFail(result)) throw new Error(result.message);

		expect(result.value).toMatchObject({enabled: true, intervalMs: 45_000});

		writeAutoSyncSettings({enabled: false});

		const after = readAutoSyncSettings();
		if (isFail(after)) throw new Error(after.message);

		expect(after.value).toMatchObject({enabled: false, intervalMs: 45_000});
	});

	it('reaches the settings store, not only the file', () => {
		writeAutoSyncSettings({enabled: true, intervalMs: 20_000});

		// Read back through the store rather than the file: this is what the
		// running process syncs on until something re-reads config, and a write
		// that only landed on disk would keep the old cadence until a restart.
		expect(patchSettingsState({})).toMatchObject({
			autoSync: true,
			autoSyncIntervalMs: 20_000,
		});
	});
});

describe('autoSyncBlockedReason', () => {
	it('names the missing editor, which is what silently stops both loops', () => {
		expect(autoSyncBlockedReason({userName: 'jola', preferredEditor: ''})).toBe(
			'no editor configured',
		);
	});

	it('names a missing username first', () => {
		expect(
			autoSyncBlockedReason({userName: null, preferredEditor: 'vim'}),
		).toBe('no username configured');
	});

	it('says nothing when auto sync would run', () => {
		expect(
			autoSyncBlockedReason({userName: 'jola', preferredEditor: 'vim'}),
		).toBeNull();
	});
});
