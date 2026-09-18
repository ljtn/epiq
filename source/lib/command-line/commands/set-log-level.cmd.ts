import {setConfig} from '../../config/user-config.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';
import {LogLevel, patchSettingsState} from '../../state/settings.state.js';

export const setLogLevelCommand = () => {
	const logLevel = getCmdState().commandMeta.inputString.trim() as LogLevel;

	const logLevels = ['debug', 'error', 'info'] as const;

	if (!logLevels.includes(logLevel)) {
		return failed('Invalid response');
	}

	const persistResult = setConfig({logLevel});

	if (isFail(persistResult)) return persistResult;

	patchSettingsState({logLevel});
	return succeeded(`Auto sync set to "${logLevel}"`, null);
};
