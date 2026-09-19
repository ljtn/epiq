import {parseAutoSyncIntervalMs} from '../../config/auto-sync-interval.js';
import {writeAutoSyncSettings} from '../../config/sync-settings.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';

export const setAutoSyncDurationCommand = () => {
	const selectionVal = getCmdState().commandMeta.inputString;

	const duration = parseAutoSyncIntervalMs(selectionVal);
	if (duration === null) {
		return failed('Auto sync duration must be a number of at least 3000 ms');
	}

	const persistResult = writeAutoSyncSettings({intervalMs: duration});
	if (isFail(persistResult)) return persistResult;

	return succeeded(`Auto sync interval set to ${duration}ms`, null);
};
