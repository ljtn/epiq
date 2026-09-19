import {yesNoToBoolean} from '../../config/setup-utils.js';
import {writeAutoSyncSettings} from '../../config/sync-settings.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';

export const setAutoSyncCommand = () => {
	const selectionVal = getCmdState().commandMeta.inputString.trim();

	if (selectionVal !== 'on' && selectionVal !== 'off') {
		return failed('Invalid response');
	}

	const selection = yesNoToBoolean(selectionVal);
	const persistResult = writeAutoSyncSettings({enabled: selection === true});

	if (isFail(persistResult)) return persistResult;

	return succeeded(`Auto sync set to "${selectionVal}"`, null);
};
