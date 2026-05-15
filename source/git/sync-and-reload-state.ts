import {
	captureNavigationAnchor,
	restoreNavigationAnchor,
} from '../lib/actions/default/restore-navigation.js';
import {bootStateFromEventLog} from '../lib/event/event-boot.js';
import {loadMergedEvents} from '../lib/event/event-load.js';
import {
	getPersistFileName,
	resolveActorId,
} from '../lib/event/event-persist.js';
import {Mode} from '../lib/model/action-map.model.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {getState, patchState} from '../lib/state/state.js';
import {trace} from '../lib/utils/logger.utils.js';
import {syncEpiqWithRemote} from './sync.js';

export const syncAndReloadState = async (): Promise<Result<boolean>> => {
	const modeFail = failReloadIfNotDefaultMode();
	if (modeFail) return modeFail;

	logger.debug('[sync] syncAndReloadState:start');

	const userRes = trace('resolveActorId', resolveActorId());
	if (isFail(userRes) || !userRes.value) {
		logger.info('[sync] unable to resolve actor id');
		return failed('Unable to resolve event log path');
	}

	patchState({
		syncStatus: {
			msg: 'Reloading synced state',
			status: 'syncing',
		},
	});

	const ownEventFileName = getPersistFileName(userRes.value);

	logger.debug('[sync] resolved own event file name', {
		ownEventFileName,
	});

	const syncResult = trace(
		'syncEpiqWithRemote',
		await syncEpiqWithRemote({ownEventFileName}),
	);
	if (isFail(syncResult)) {
		logger.error('[sync] syncAndReloadState:sync failed', syncResult.message);
		return failed(`Unable to sync state. ${syncResult.message}`);
	}

	const {stateBranchRoot} = syncResult.value;

	logger.debug('[sync] loading merged events after sync', {
		stateBranchRoot,
	});

	const allLoadedEventsResult = trace(
		'loadMergedEvents',
		loadMergedEvents(stateBranchRoot),
	);
	if (isFail(allLoadedEventsResult)) {
		return failed(`Unable to load events. ${allLoadedEventsResult.message}`);
	}

	logger.debug('[sync] loaded merged events after sync', {
		count: allLoadedEventsResult.value.length,
	});

	const lateModeFail = failReloadIfNotDefaultMode();
	if (lateModeFail) return lateModeFail;

	const navigationAnchor = captureNavigationAnchor();

	if (
		// Only reboot if not on virtual nodes
		!getState().selectedNode?.isVirtual &&
		!getState().contextNode?.isVirtual
	) {
		const bootResult = trace(
			'bootStateFromEventLog',
			bootStateFromEventLog(allLoadedEventsResult.value),
		);
		if (isFail(bootResult)) {
			return failed(`Unable to boot synced state. ${bootResult.message}`);
		}
	}

	logger.debug('[sync] booted state from synced events');

	const restoreResult = trace(
		'restoreNavigationAnchor',
		restoreNavigationAnchor(navigationAnchor),
	);

	if (isFail(restoreResult)) return restoreResult;

	patchState({
		hasProjectDefinition: true,
		syncStatus: {
			msg: 'Synced',
			status: 'synced',
		},
	});

	logger.debug('[sync] syncAndReloadState:done');

	return succeeded('Synced', true);
};
const failReloadIfNotDefaultMode = (): Result<null> | null => {
	if (getState().mode === Mode.DEFAULT) return null;

	patchState({
		syncStatus: {
			msg: 'Reload skipped while editing',
			status: 'pending',
		},
	});

	return failed(
		'Will not re-materialize if not in default mode, to not lose edit data',
	);
};
