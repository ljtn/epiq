import {broadcastGuiMessage} from '../../gui/client/lib/gui-broadcast.js';
import {failed, Result} from '../model/result-types.js';
import {isStateInitialized, patchState} from './state.js';

type SyncStatus = {
	status: 'synced' | 'failed' | 'syncing';
	msg: string;
};

const patchSyncStatus = (syncStatus: SyncStatus) => {
	if (!isStateInitialized()) return;

	patchState({syncStatus});

	broadcastGuiMessage({
		type: 'sync-status',
		payload: syncStatus,
	});
};

export const setSyncing = (msg = 'Syncing...') => {
	patchSyncStatus({
		status: 'syncing',
		msg,
	});
};

export const setSynced = (msg = 'Synced') => {
	patchSyncStatus({
		status: 'synced',
		msg,
	});
};

export const setSyncFailed = (msg: string) => {
	patchSyncStatus({
		status: 'failed',
		msg,
	});
};

export const failSync = <T>(message: string): Result<T> => {
	setSyncFailed(message);
	return failed(message);
};
