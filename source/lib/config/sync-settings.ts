// The auto sync preference: reading it, changing it, and saying when it is on
// but cannot run.
//
// Three surfaces ask — `:config autosync` and `:config autosync-duration` in
// the TUI, the identity panel in the GUI, and the two sync loops that obey it.
// Changing it is two steps, not one: the config file is what survives a
// restart, and the settings store is what this process is acting on until
// then. A caller that did only the first would go on syncing at the old
// cadence until something else re-read the file.

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
	/**
	 * Why an enabled auto sync would still not run, or null where it would.
	 *
	 * Both loops require a name and an editor before they do anything, and
	 * silently: without this a toggle switched on reports success and then
	 * nothing ever syncs, with nowhere to find out why.
	 */
	blockedReason: string | null;
};

/**
 * What stops auto sync running, whatever the preference says.
 *
 * Pure over the pair, because the two callers hold it in different places: the
 * GUI's loop has resolved settings in hand before anything has booted, and the
 * TUI's store is filled by then. Reading the store here would have told the
 * loop that nobody is configured on a machine whose actor comes from the
 * environment.
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
 * Why auto sync would not run on this machine, as the loops decide it.
 *
 * The resolution failing is itself a blocker, and has to be reported as one:
 * the GUI's loop gives up outright when `loadSettingsFromConfig` fails, so a
 * panel that fell back to the raw config would find a name and an editor
 * there, report all-clear, and leave somebody watching a toggle that is on
 * while nothing ever syncs — which is the exact silence this field exists to
 * break. `EPIQ_USER_ID` exported without `EPIQ_USER_NAME` reaches it.
 *
 * The raw config is still consulted, but only to name the missing field, since
 * the resolver's own message is about an actor rather than about a setting.
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
 * Changes whichever of the two the caller named, and reports what they now are.
 *
 * Partial on purpose: the panel's toggle and its interval field are two
 * controls over one config file, and a write that carried both would have each
 * of them overwriting whatever the other had just done.
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

	return readAutoSyncSettings();
};
