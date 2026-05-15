import {yesNoToBoolean} from '../../config/setup-utils.js';
import {setConfig} from '../../config/user-config.js';
import {Mode} from '../../model/action-map.model.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';
import {patchSettingsState} from '../../state/settings.state.js';
import {patchState} from '../../state/state.js';

export const setAutoSyncCommand = () => {
	const selectionVal = getCmdState().commandMeta.inputString.trim();

	if (selectionVal !== 'on' && selectionVal !== 'off') {
		return failed('Invalid response');
	}

	const selection = yesNoToBoolean(selectionVal);
	const persistResult = setConfig({autoSync: selection});

	if (isFail(persistResult)) return persistResult;

	patchSettingsState({autoSync: selection});
	patchState({mode: Mode.DEFAULT});

	return succeeded(`Auto sync set to "${selectionVal}"`, null);
};
