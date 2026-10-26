// The auto sync preference: reading it, changing it, and saying why it can't
// run. A change writes the config file and the settings store, or loops keep the old cadence.

import {
	effectiveAutoSyncIntervalMs,
	MAX_AUTO_SYNC_INTERVAL_MS,
	MIN_AUTO_SYNC_INTERVAL_MS,
	parseAutoSyncIntervalMs,
} from './auto-sync-interval.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {patchSettingsState} from '../state/settings.state.js';
import {
	EpiqConfig,
	loadSettingsFromConfig,
	readEpiqConfig,
	setConfig,
} from './user-config.js';

export type AutoSyncSettings = {
	enabled: boolean;
	intervalMs: number;
	/** Why an enabled auto sync would still not run, or null where it would. */
	blockedReason: string | null;
};

/**
 * What stops auto sync running, whatever the preference says. Pure over the
 * pair: the GUI's loop calls it before the store is filled.
 */
export const autoSyncBlockedReason = (identity: {
	userName: string | null | undefined;
	preferredEditor: string | null | undefined;
}): string | null => {
	if (!identity.userName?.trim()) return 'no username configured';
	if (!identity.preferredEditor?.trim()) return 'no editor configured';

	return null;
};

/**
 * Why auto sync would not run here, as the loops decide it. A failed resolution
 * is itself a blocker; the raw config only names the missing field.
 */
const blockedReasonFor = (config: EpiqConfig): string | null => {
	const resolved = loadSettingsFromConfig();

	if (isFail(resolved)) {
		return (
			autoSyncBlockedReason({
				userName: config.userName,
				preferredEditor: config.preferredEditor,
			}) ?? resolved.message
		);
	}

	return autoSyncBlockedReason(resolved.value);
};

export const readAutoSyncSettings = (): Result<AutoSyncSettings> => {
	const config = readEpiqConfig();
	if (isFail(config)) return failed(config.message);

	return succeeded('Read auto sync settings', {
		enabled: config.value.autoSync === true,
		intervalMs: effectiveAutoSyncIntervalMs(config.value.autoSyncDebounceMs),
		blockedReason: blockedReasonFor(config.value),
	});
};

/**
 * Changes only the fields named, so the panel's toggle and interval don't
 * overwrite each other, and reports the result.
 */
export const writeAutoSyncSettings = (patch: {
	enabled?: boolean;
	intervalMs?: number;
}): Result<AutoSyncSettings> => {
	const intervalMs =
		patch.intervalMs === undefined
			? undefined
			: parseAutoSyncIntervalMs(patch.intervalMs);

	if (patch.intervalMs !== undefined && intervalMs === null) {
		return failed(
			`Auto sync interval must be a whole number of milliseconds between ${MIN_AUTO_SYNC_INTERVAL_MS} and ${MAX_AUTO_SYNC_INTERVAL_MS}`,
		);
	}

	// Read before writing, so the answer can be assembled even if the read-back fails.
	const before = readAutoSyncSettings();
	if (isFail(before)) return before;

	const persisted = setConfig({
		...(patch.enabled === undefined ? {} : {autoSync: patch.enabled}),
		...(intervalMs === undefined || intervalMs === null
			? {}
			: {autoSyncDebounceMs: intervalMs}),
	});

	if (isFail(persisted)) return failed(persisted.message);

	patchSettingsState({
		...(patch.enabled === undefined ? {} : {autoSync: patch.enabled}),
		...(intervalMs === undefined || intervalMs === null
			? {}
			: {autoSyncIntervalMs: intervalMs}),
	});

	// The write has landed, so a failed read-back must not report failure, or
	// the GUI skips rescheduling and its loop keeps the old cadence.
	const after = readAutoSyncSettings();
	if (!isFail(after)) return after;

	return succeeded('Changed auto sync settings', {
		...before.value,
		...(patch.enabled === undefined ? {} : {enabled: patch.enabled}),
		...(intervalMs === undefined || intervalMs === null ? {} : {intervalMs}),
	});
};
