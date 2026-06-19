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
import {failSync} from '../lib/state/sync-state.js';
import {trace} from '../lib/utils/logger.utils.js';
import {syncEpiqWithRemote} from './sync.js';

let syncAndReloadPromise: Promise<Result<boolean>> | null = null;

export const syncAndReloadState = async (): Promise<Result<boolean>> => {
	logger.debug('[sync] syncAndReloadState enter', {
		hasPromise: Boolean(syncAndReloadPromise),
		currentStatus: getState().syncStatus?.status,
		currentMessage: getState().syncStatus?.msg,
	});

	if (syncAndReloadPromise) {
		logger.debug('[sync] syncAndReloadState joining existing promise');
		return syncAndReloadPromise;
	}

	logger.debug('[sync] syncAndReloadState creating promise');

	syncAndReloadPromise = syncAndReloadStateUnsafe();

	try {
		const result = await syncAndReloadPromise;

		logger.debug('[sync] syncAndReloadState promise resolved', {
			success: !isFail(result),
			message: isFail(result) ? result.message : result.message,
			statusAfterResolve: getState().syncStatus?.status,
			statusMessageAfterResolve: getState().syncStatus?.msg,
		});

		if (isFail(result) && getState().syncStatus?.status === 'syncing') {
			logger.debug('[sync] syncAndReloadState correcting stale syncing status');

			patchState({
				syncStatus: {
					msg: result.message,
					status: 'failed',
				},
			});
		}

		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		logger.error('[sync] syncAndReloadState promise threw', {
			message,
			error,
		});

		if (syncAndReloadPromise) {
			return syncAndReloadPromise;
		}

		return failed(message);
	} finally {
		logger.debug('[sync] syncAndReloadState clearing promise', {
			statusBeforeClear: getState().syncStatus?.status,
			statusMessageBeforeClear: getState().syncStatus?.msg,
		});

		syncAndReloadPromise = null;
	}
};

const syncAndReloadStateUnsafe = async (): Promise<Result<boolean>> => {
	logger.debug('[sync] syncAndReloadStateUnsafe:start', {
		mode: getState().mode,
		syncStatus: getState().syncStatus,
	});

	const modeFail = failReloadIfNotDefaultMode();
	if (modeFail) {
		logger.debug('[sync] syncAndReloadStateUnsafe:blocked by mode', {
			mode: getState().mode,
			message: modeFail.message,
			syncStatus: getState().syncStatus,
		});

		return modeFail;
	}

	if (syncAndReloadPromise) {
		return syncAndReloadPromise;
	}

	logger.debug('[sync] syncAndReloadState:start');

	const userRes = trace('resolveActorId', resolveActorId());
	if (isFail(userRes) || !userRes.value) {
		logger.info('[sync] unable to resolve actor id', {
			message: isFail(userRes) ? userRes.message : 'Missing actor id',
		});

		return failed('Unable to resolve event log path');
	}

	patchState({
		syncStatus: {
			msg: 'Reloading synced state',
			status: 'syncing',
		},
	});

	logger.debug('[sync] sync status patched to syncing', {
		syncStatus: getState().syncStatus,
	});

	const ownEventFileName = getPersistFileName(userRes.value);

	logger.debug('[sync] resolved own event file name', {
		ownEventFileName,
	});

	logger.debug('[sync] syncEpiqWithRemote:start');

	const syncResult = trace(
		'syncEpiqWithRemote',
		await syncEpiqWithRemote({ownEventFileName}),
	);

	logger.debug('[sync] syncEpiqWithRemote:result', {
		success: !isFail(syncResult),
		message: isFail(syncResult) ? syncResult.message : syncResult.message,
	});

	if (isFail(syncResult)) {
		logger.error('[sync] syncAndReloadState:sync failed', syncResult.message);

		patchState({
			syncStatus: {
				msg: 'Sync failed',
				status: 'failed',
			},
		});

		logger.debug('[sync] sync status patched to failed after sync failure', {
			syncStatus: getState().syncStatus,
		});

		return failSync(`Unable to sync state. ${syncResult.message}`);
	}

	const {stateBranchRoot} = syncResult.value;

	logger.debug('[sync] loading merged events after sync', {
		stateBranchRoot,
	});

	const allLoadedEventsResult = trace(
		'loadMergedEvents',
		loadMergedEvents(stateBranchRoot),
	);

	logger.debug('[sync] loadMergedEvents:result', {
		success: !isFail(allLoadedEventsResult),
		message: isFail(allLoadedEventsResult)
			? allLoadedEventsResult.message
			: allLoadedEventsResult.message,
		count: isFail(allLoadedEventsResult)
			? undefined
			: allLoadedEventsResult.value.length,
	});

	if (isFail(allLoadedEventsResult)) {
		patchState({
			syncStatus: {
				msg: 'Reload failed',
				status: 'failed',
			},
		});

		logger.debug('[sync] sync status patched to failed after load failure', {
			syncStatus: getState().syncStatus,
		});

		return failed(`Unable to load events. ${allLoadedEventsResult.message}`);
	}

	logger.debug('[sync] loaded merged events after sync', {
		count: allLoadedEventsResult.value.length,
	});

	const lateModeFail = failReloadIfNotDefaultMode();
	if (lateModeFail) {
		logger.debug('[sync] syncAndReloadStateUnsafe:blocked by late mode check', {
			mode: getState().mode,
			message: lateModeFail.message,
			syncStatus: getState().syncStatus,
		});

		return lateModeFail;
	}

	const navigationAnchor = captureNavigationAnchor();
	const previousFilters = getState().filters;

	logger.debug('[sync] captured navigation anchor', {
		navigationAnchor,
		selectedNodeId: getState().selectedNode?.id,
		contextNodeId: getState().contextNode?.id,
		selectedNodeIsVirtual: getState().selectedNode?.isVirtual,
		contextNodeIsVirtual: getState().contextNode?.isVirtual,
	});

	if (
		!getState().selectedNode?.isVirtual &&
		!getState().contextNode?.isVirtual
	) {
		logger.debug('[sync] bootStateFromEventLog:start', {
			eventCount: allLoadedEventsResult.value.length,
		});

		const bootResult = trace(
			'bootStateFromEventLog',
			bootStateFromEventLog(allLoadedEventsResult.value),
		);

		logger.debug('[sync] bootStateFromEventLog:result', {
			success: !isFail(bootResult),
			message: isFail(bootResult) ? bootResult.message : bootResult.message,
		});

		if (isFail(bootResult)) {
			patchState({
				syncStatus: {
					msg: 'Reload failed',
					status: 'failed',
				},
			});

			logger.debug('[sync] sync status patched to failed after boot failure', {
				syncStatus: getState().syncStatus,
			});

			return failed(`Unable to boot synced state. ${bootResult.message}`);
		}
	} else {
		logger.debug('[sync] skipped bootStateFromEventLog for virtual node', {
			selectedNodeIsVirtual: getState().selectedNode?.isVirtual,
			contextNodeIsVirtual: getState().contextNode?.isVirtual,
		});
	}

	logger.debug('[sync] booted state from synced events');

	// Boot replays init.workspace, which re-initializes state with empty
	// filters. Filters are view state, not event-log data, so re-apply the
	// pre-sync filters before restoring navigation against the filtered view.
	patchState({filters: previousFilters});

	logger.debug('[sync] restoreNavigationAnchor:start');

	const restoreResult = trace(
		'restoreNavigationAnchor',
		restoreNavigationAnchor(navigationAnchor),
	);

	logger.debug('[sync] restoreNavigationAnchor:result', {
		success: !isFail(restoreResult),
		message: isFail(restoreResult)
			? restoreResult.message
			: 'Navigation restored',
		selectedNodeId: getState().selectedNode?.id,
		contextNodeId: getState().contextNode?.id,
	});

	if (isFail(restoreResult)) {
		patchState({
			syncStatus: {
				msg: 'Reload failed',
				status: 'failed',
			},
		});

		logger.debug('[sync] sync status patched to failed after restore failure', {
			syncStatus: getState().syncStatus,
		});

		return restoreResult;
	}

	patchState({
		hasProjectDefinition: true,
		syncStatus: {
			msg: 'Synced',
			status: 'synced',
		},
	});

	logger.debug('[sync] syncAndReloadState:done', {
		syncStatus: getState().syncStatus,
	});

	return succeeded('Synced', true);
};

const failReloadIfNotDefaultMode = (): Result<null> | null => {
	if (getState().mode === Mode.DEFAULT) return null;

	logger.debug('[sync] failReloadIfNotDefaultMode', {
		mode: getState().mode,
		syncStatus: getState().syncStatus,
	});

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
