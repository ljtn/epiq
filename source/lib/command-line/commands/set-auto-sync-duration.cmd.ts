import {
	MAX_AUTO_SYNC_INTERVAL_MS,
	MIN_AUTO_SYNC_INTERVAL_MS,
	parseAutoSyncIntervalMs,
} from '../../config/auto-sync-interval.js';
import {writeAutoSyncSettings} from '../../config/sync-settings.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';

export const setAutoSyncDurationCommand = () => {
	const selectionVal = getCmdState().commandMeta.inputString;

	const duration = parseAutoSyncIntervalMs(selectionVal);
	if (duration === null) {
		// Both bounds, since there are now two ways to be refused and naming
		// only the floor sends somebody over the ceiling the wrong way.
		return failed(
			`Auto sync duration must be a whole number of milliseconds between ${MIN_AUTO_SYNC_INTERVAL_MS} and ${MAX_AUTO_SYNC_INTERVAL_MS}`,
		);
	}

	const persistResult = writeAutoSyncSettings({intervalMs: duration});
	if (isFail(persistResult)) return persistResult;

	return succeeded(`Auto sync interval set to ${duration}ms`, null);
};
