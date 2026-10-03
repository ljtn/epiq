import {syncAndReloadState} from '../../../git/sync-and-reload-state.js';
import {Mode} from '../../model/action-map.model.js';
import {failed, isFail} from '../../model/result-types.js';
import {replaceCmdInput} from '../../state/cmd.state.js';
import {getSafeState, patchState} from '../../state/state.js';

export const syncCommand = async () => {
	replaceCmdInput('');
	patchState({
		mode: Mode.DEFAULT,
	});

	const stateResult = getSafeState();
	if (isFail(stateResult)) {
		return failed(stateResult.message);
	}

	if (stateResult.value.syncStatus.status === 'syncing') {
		return failed('Sync already in progress');
	}

	patchState({
		syncStatus: {
			msg: 'Syncing',
			status: 'syncing',
		},
	});

	const result = await syncAndReloadState();

	if (isFail(result)) {
		patchState({
			syncStatus: {
				msg: result.message,
				status: 'failed',
			},
		});

		return result;
	}

	patchState({
		mode: Mode.DEFAULT,
		syncStatus: {
			msg: 'Synced',
			status: 'synced',
		},
	});

	return result;
};
