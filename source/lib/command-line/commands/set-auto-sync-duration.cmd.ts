import z from 'zod';
import {setConfig} from '../../config/user-config.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';
import {patchSettingsState} from '../../state/settings.state.js';

export const setAutoSyncDurationCommand = () => {
	const selectionVal = getCmdState().commandMeta.inputString;

	const duration = z.coerce.number().int().min(3_000).safeParse(selectionVal);
	if (!duration.success) {
		return failed('Auto sync duration must be a number of at least 3000 ms');
	}

	const persistResult = setConfig({autoSyncDebounceMs: duration.data});
	if (isFail(persistResult)) return persistResult;

	patchSettingsState({autoSyncIntervalMs: duration.data});
	return succeeded(`Auto sync interval set to ${duration.data}ms`, null);
};
