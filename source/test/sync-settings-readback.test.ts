// A failed read-back after the write landed must still report success, or the
// GUI loop keeps the old cadence. Unreachable with real files, hence the mock.

import {beforeEach, describe, expect, it, vi} from 'vitest';
import {failed, succeeded} from '../lib/model/result-types.js';

let reads = 0;
let failFrom = Number.POSITIVE_INFINITY;

vi.mock('../lib/config/user-config.js', () => ({
	readEpiqConfig: vi.fn(() => {
		reads += 1;

		return reads >= failFrom
			? failed('Invalid ~/.epiq-global/config.json JSON')
			: succeeded('config', {
					autoSync: false,
					autoSyncDebounceMs: 20_000,
					userName: 'jola',
					preferredEditor: 'vim',
			  });
	}),
	loadSettingsFromConfig: vi.fn(() =>
		succeeded('settings', {userName: 'jola', preferredEditor: 'vim'}),
	),
	setConfig: vi.fn(() => succeeded('Wrote', null)),
}));

vi.mock('../lib/state/settings.state.js', () => ({
	patchSettingsState: vi.fn(),
	getSettingsState: vi.fn(() => ({userName: 'jola', preferredEditor: 'vim'})),
}));

const {writeAutoSyncSettings} = await import('../lib/config/sync-settings.js');
const {isFail, isSuccess} = await import('../lib/model/result-types.js');
const {setConfig} = await import('../lib/config/user-config.js');

beforeEach(() => {
	reads = 0;
	failFrom = Number.POSITIVE_INFINITY;
	vi.mocked(setConfig).mockClear();
});

describe('writeAutoSyncSettings, when the read-back fails', () => {
	it('still reports the change as made', () => {
		// The first read succeeds and the write goes out; the second fails.
		failFrom = 2;

		const result = writeAutoSyncSettings({enabled: true});

		expect(vi.mocked(setConfig)).toHaveBeenCalledWith({autoSync: true});
		expect(isSuccess(result)).toBe(true);
	});

	it('answers with the patch applied over what it read first', () => {
		failFrom = 2;

		const result = writeAutoSyncSettings({enabled: true});
		if (isFail(result)) throw new Error(result.message);

		// `enabled` from the patch, `intervalMs` from the read taken before the
		// write — which is the only reason that read happens at all.
		expect(result.value).toMatchObject({enabled: true, intervalMs: 20_000});
	});

	it('refuses when it cannot read even before writing', () => {
		failFrom = 1;

		expect(isFail(writeAutoSyncSettings({enabled: true}))).toBe(true);
		expect(vi.mocked(setConfig)).not.toHaveBeenCalled();
	});
});
