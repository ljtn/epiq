// The auto sync preference as the panel and `:config` change it, against a real
// config file, since the round trip through it is the point.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	DEFAULT_AUTO_SYNC_INTERVAL_MS,
	effectiveAutoSyncIntervalMs,
	MAX_AUTO_SYNC_INTERVAL_MS,
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
		expect(result.value.blockedReason).toBeNull();
	});

	// An unresolvable actor (an id with no name) blocks auto sync, whatever the
	// raw config holds.
	it('is blocked when the actor will not resolve, however complete the file looks', () => {
		const originalId = process.env['EPIQ_USER_ID'];
		const originalName = process.env['EPIQ_USER_NAME'];
		process.env['EPIQ_USER_ID'] = 'from-the-environment';
		delete process.env['EPIQ_USER_NAME'];

		try {
			const result = readAutoSyncSettings();
			if (isFail(result)) throw new Error(result.message);

			expect(result.value.blockedReason).not.toBeNull();
		} finally {
			if (originalId === undefined) delete process.env['EPIQ_USER_ID'];
			else process.env['EPIQ_USER_ID'] = originalId;
			if (originalName !== undefined) {
				process.env['EPIQ_USER_NAME'] = originalName;
			}
		}
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

	// Past 2^31-1 ms `setTimeout` clamps the delay to 1ms.
	it('refuses an interval long enough to overflow a timer', () => {
		expect(
			isFail(
				writeAutoSyncSettings({intervalMs: MAX_AUTO_SYNC_INTERVAL_MS + 1}),
			),
		).toBe(true);
		expect(isFail(writeAutoSyncSettings({intervalMs: 3_600_000 * 1000}))).toBe(
			true,
		);
		expect(configOnDisk().autoSyncDebounceMs).toBeUndefined();
	});

	it('takes the ceiling itself', () => {
		expect(
			isSuccess(writeAutoSyncSettings({intervalMs: MAX_AUTO_SYNC_INTERVAL_MS})),
		).toBe(true);
	});

	it('takes the floor itself', () => {
		const result = writeAutoSyncSettings({
			intervalMs: MIN_AUTO_SYNC_INTERVAL_MS,
		});

		expect(isSuccess(result)).toBe(true);
		expect(configOnDisk().autoSyncDebounceMs).toBe(MIN_AUTO_SYNC_INTERVAL_MS);
	});

	// Two controls over one file must not overwrite each other.
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

		// Read back through the store, which the running process syncs on.
		expect(patchSettingsState({})).toMatchObject({
			autoSync: true,
			autoSyncIntervalMs: 20_000,
		});
	});
});

// The loops read a hand-editable file, so bounds apply at the point of use too.
describe('effectiveAutoSyncIntervalMs', () => {
	it('caps a stored value that would overflow the timer', () => {
		expect(effectiveAutoSyncIntervalMs(3_600_000 * 1000)).toBe(
			MAX_AUTO_SYNC_INTERVAL_MS,
		);
	});

	it('never returns a delay that would busy-loop', () => {
		expect(effectiveAutoSyncIntervalMs(0)).toBe(1);
		expect(effectiveAutoSyncIntervalMs(-5)).toBe(1);
	});

	it('answers an unset value with the default', () => {
		expect(effectiveAutoSyncIntervalMs(null)).toBe(
			DEFAULT_AUTO_SYNC_INTERVAL_MS,
		);
		expect(effectiveAutoSyncIntervalMs(undefined)).toBe(
			DEFAULT_AUTO_SYNC_INTERVAL_MS,
		);
	});

	// Policy the two doors enforce on what a person may ask for, not a
	// correctness bound — and the suites drive the loop fast on purpose.
	it('leaves a sub-floor value alone', () => {
		expect(effectiveAutoSyncIntervalMs(1)).toBe(1);
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
