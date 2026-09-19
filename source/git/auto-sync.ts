import {effectiveAutoSyncIntervalMs} from '../lib/config/auto-sync-interval.js';
import {failed, isFail} from '../lib/model/result-types.js';
import {getSettingsState} from '../lib/state/settings.state.js';
import {
	getSafeState,
	getState,
	isStateInitialized,
	patchState,
} from '../lib/state/state.js';
import {syncAndReloadState} from '../git/sync-and-reload-state.js';

let lastAutoSyncStartedAt = 0;
let queuedAutoSyncTimer: NodeJS.Timeout | undefined;
let autoSyncInFlight = false;
let pendingAutoSync = false;

const isSyncing = () => {
	if (autoSyncInFlight) return true;

	const stateResult = getSafeState();
	if (isFail(stateResult)) return false;

	return stateResult.value.syncStatus.status === 'syncing';
};

const getAutoSyncDelay = () => {
	const intervalMs = effectiveAutoSyncIntervalMs(
		getSettingsState().autoSyncIntervalMs,
	);
	const elapsed = Date.now() - lastAutoSyncStartedAt;

	return Math.max(0, intervalMs - elapsed);
};

const scheduleQueuedAutoSync = () => {
	if (queuedAutoSyncTimer) return;

	queuedAutoSyncTimer = setTimeout(async () => {
		queuedAutoSyncTimer = undefined;

		if (!isStateInitialized()) return;

		if (isSyncing()) {
			pendingAutoSync = true;
			return;
		}

		pendingAutoSync = false;
		await autoSync();
	}, getAutoSyncDelay());
};

export const autoSync = async () => {
	if (
		getState().readOnly ||
		getState().timeMode === 'peek' ||
		getState().timeMode === 'replay'
	) {
		return failed('Cannot auto-sync while peeking');
	}

	if (!isStateInitialized()) {
		return failed('Cannot auto-sync before state is initialized');
	}

	if (isSyncing()) {
		pendingAutoSync = true;
		return failed('Sync already in progress');
	}

	autoSyncInFlight = true;
	lastAutoSyncStartedAt = Date.now();

	patchState({
		syncStatus: {
			msg: 'Auto-syncing',
			status: 'syncing',
		},
	});

	try {
		return await syncAndReloadState();
	} finally {
		autoSyncInFlight = false;

		if (pendingAutoSync) {
			scheduleQueuedAutoSync();
		}
	}
};

export const queueAutoSync = () => {
	if (!isStateInitialized()) return;

	pendingAutoSync = true;

	if (isSyncing()) return;

	scheduleQueuedAutoSync();
};
