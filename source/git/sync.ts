import fs from 'node:fs';
import path from 'node:path';
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
import {failSync, setSynced, setSyncing} from '../lib/state/sync-state.js';
import {trace} from '../lib/utils/logger.utils.js';
import {getStateBranch} from './git-constants.js';
import {
	ensureStateBranchLayout,
	getRelativeEventFilePath,
	getRepoRootDir,
	getStateBranchRoot,
} from './git-storage.js';
import {
	execGit,
	execGitAllowFail,
	hasInProgressGitOperation,
	hasStagedChanges,
	isDetachedHead,
	isNonFastForward,
	pullBranchRebaseIfPresent,
	resetBranchHardToRemote,
} from './git-utils.js';
import {
	bootstrapStateBranchStorage,
	createStateBranchSyncCommit,
	ensureInitialCommit,
	pushStateBranch,
	stageStateBranchOwnEventFile,
} from './git.js';
import {
	mergePersistedEvents,
	parsePersistedEvents,
	serializePersistedEvents,
} from './merge.js';

type SyncSummary = {
	repoRoot: string;
	stateBranchRoot: string;
	createdCommit: boolean;
	commitSha?: string;
	pulled: boolean;
	pushed: boolean;
	bootstrapped: boolean;
};

type SyncArgs = {
	cwd?: string;
	ownEventFileName: string;
};

type SyncOwnFileCommitResult = {
	createdCommit: boolean;
	commitSha?: string;
};

const readFileIfExists = (filePath: string): string | null =>
	fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;

const writeFileIfChanged = (filePath: string, content: string): boolean => {
	const current = readFileIfExists(filePath);
	if (current === content) return false;

	fs.mkdirSync(path.dirname(filePath), {recursive: true});
	fs.writeFileSync(filePath, content, 'utf8');
	return true;
};

const getOwnEventPath = ({
	stateBranchRoot,
	ownEventFileName,
}: {
	stateBranchRoot: string;
	ownEventFileName: string;
}): string =>
	path.join(stateBranchRoot, getRelativeEventFilePath(ownEventFileName));

const restoreOwnEventFileToHead = async ({
	stateBranchRoot,
	ownEventFileName,
}: {
	stateBranchRoot: string;
	ownEventFileName: string;
}): Promise<Result<null>> => {
	const relativePath = getRelativeEventFilePath(ownEventFileName);
	const absolutePath = path.join(stateBranchRoot, relativePath);

	const checkoutResult = await execGitAllowFail({
		cwd: stateBranchRoot,
		args: ['checkout', '--', relativePath],
	});

	if (checkoutResult.exitCode !== 0 && fs.existsSync(absolutePath)) {
		fs.rmSync(absolutePath, {force: true});
	}

	return succeeded('Restored own event file to HEAD', null);
};

const mergeOwnSnapshot = ({
	ownEventPath,
	ownSnapshot,
}: {
	ownEventPath: string;
	ownSnapshot: string | null;
}): Result<boolean> => {
	if (ownSnapshot === null) return succeeded('No own snapshot to merge', false);

	const remoteContent = readFileIfExists(ownEventPath) ?? '';

	const remoteEventsResult = parsePersistedEvents(remoteContent);
	if (isFail(remoteEventsResult)) return failed(remoteEventsResult.message);

	const localEventsResult = parsePersistedEvents(ownSnapshot);
	if (isFail(localEventsResult)) return failed(localEventsResult.message);

	const merged = mergePersistedEvents(
		remoteEventsResult.value,
		localEventsResult.value,
	);

	const changed = writeFileIfChanged(
		ownEventPath,
		serializePersistedEvents(merged),
	);

	return succeeded('Merged own snapshot', changed);
};
const snapshotEventFiles = (
	stateBranchRoot: string,
): Result<Map<string, string>> => {
	const eventsDir = path.join(stateBranchRoot, '.epiq', 'events');
	const snapshots = new Map<string, string>();

	if (!fs.existsSync(eventsDir)) {
		return succeeded('No event files to snapshot', snapshots);
	}

	for (const fileName of fs.readdirSync(eventsDir)) {
		if (!fileName.endsWith('.jsonl')) continue;

		const filePath = path.join(eventsDir, fileName);
		if (!fs.statSync(filePath).isFile()) continue;

		snapshots.set(fileName, fs.readFileSync(filePath, 'utf8'));
	}

	return succeeded('Snapshotted event files', snapshots);
};

const restoreEventFilesToHead = async (
	stateBranchRoot: string,
): Promise<Result<null>> => {
	const checkoutResult = await execGitAllowFail({
		cwd: stateBranchRoot,
		args: ['checkout', '--', getRelativeEventFilePath('')],
	});

	if (checkoutResult.exitCode !== 0) {
		const eventsDir = path.join(stateBranchRoot, '.epiq', 'events');
		if (fs.existsSync(eventsDir)) {
			fs.rmSync(eventsDir, {recursive: true, force: true});
		}
	}

	return succeeded('Restored event files to HEAD', null);
};

const mergeEventSnapshots = ({
	stateBranchRoot,
	snapshots,
}: {
	stateBranchRoot: string;
	snapshots: Map<string, string>;
}): Result<boolean> => {
	let changed = false;

	for (const [fileName, snapshotContent] of snapshots) {
		const eventPath = path.join(
			stateBranchRoot,
			getRelativeEventFilePath(fileName),
		);

		const remoteContent = readFileIfExists(eventPath) ?? '';

		const remoteEventsResult = parsePersistedEvents(remoteContent);
		if (isFail(remoteEventsResult)) return failed(remoteEventsResult.message);

		const localEventsResult = parsePersistedEvents(snapshotContent);
		if (isFail(localEventsResult)) return failed(localEventsResult.message);

		const merged = mergePersistedEvents(
			remoteEventsResult.value,
			localEventsResult.value,
		);

		changed =
			writeFileIfChanged(eventPath, serializePersistedEvents(merged)) ||
			changed;
	}

	return succeeded('Merged event snapshots', changed);
};

export const resetHardToRemoteState = async (
	cwd = process.cwd(),
): Promise<Result<{repoRoot: string; stateBranchRoot: string}>> => {
	logger.info('[sync] syncEpiqFromRemote:start', cwd);

	setSyncing('Syncing from remote');

	const ready = trace(
		'ensureSyncReady',
		await ensureSyncReady({
			cwd,
			ensureUpstream: false,
		}),
	);
	if (isFail(ready)) return failSync(ready.message);

	const {repoRoot, stateBranchRoot} = ready.value;

	const stateBranchResult = trace('getStateBranch', getStateBranch(repoRoot));
	if (isFail(stateBranchResult)) return failSync(stateBranchResult.message);

	const stateBranch = stateBranchResult.value;

	const snapshotsResult = trace(
		'snapshotEventFiles',
		snapshotEventFiles(stateBranchRoot),
	);
	if (isFail(snapshotsResult)) return failSync(snapshotsResult.message);

	const restoreResult = trace(
		'restoreEventFilesToHead',
		await restoreEventFilesToHead(stateBranchRoot),
	);
	if (isFail(restoreResult)) return failSync(restoreResult.message);

	const resetResult = trace(
		'resetBranchHardToRemote',
		await resetBranchHardToRemote({
			cwd: stateBranchRoot,
			branch: stateBranch,
		}),
	);
	if (isFail(resetResult)) return failSync(resetResult.message);

	const mergeResult = trace(
		'mergeEventSnapshots',
		mergeEventSnapshots({
			stateBranchRoot,
			snapshots: snapshotsResult.value,
		}),
	);
	if (isFail(mergeResult)) return failSync(mergeResult.message);

	setSynced(
		mergeResult.value ? 'Synced and merged local state' : 'Synced from remote',
	);

	logger.info('[sync] syncEpiqFromRemote:done');

	return succeeded('Synced state branch from remote', {
		repoRoot,
		stateBranchRoot,
	});
};

const ensureSyncReady = async ({
	cwd,
	ensureUpstream,
}: {
	cwd: string;
	ensureUpstream: boolean;
}): Promise<
	Result<{
		repoRoot: string;
		stateBranchRoot: string;
		bootstrapped: boolean;
	}>
> => {
	logger.info('[sync] ensureSyncReady:start', {cwd, ensureUpstream});

	const repoRootResult = trace('getRepoRootDir', await getRepoRootDir(cwd));
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const repoRoot = repoRootResult.value;

	logger.info('[sync] repo root', repoRoot);

	const stateBranchRootResult = trace(
		'getStateBranchRoot',
		getStateBranchRoot({repoRoot}),
	);
	if (isFail(stateBranchRootResult)) {
		return failed(stateBranchRootResult.message);
	}

	const stateBranchRoot = stateBranchRootResult.value;

	logger.info('[sync] state branch root', stateBranchRoot);

	const initResult = trace(
		'ensureInitialCommit',
		await ensureInitialCommit(repoRoot),
	);
	if (isFail(initResult)) return failed(initResult.message);

	logger.info('[sync] initial commit result', {
		created: initResult.value,
	});

	logger.info('[sync] bootstrapping state branch storage', {
		repoRoot,
		stateBranchRoot,
		ensureUpstream,
	});

	const bootstrapResult = trace(
		'bootstrapStateBranchStorage',
		await bootstrapStateBranchStorage({
			repoRoot,
			stateBranchRoot,
			ensureUpstream,
		}),
	);
	if (isFail(bootstrapResult)) return failed(bootstrapResult.message);

	logger.info('[sync] bootstrap result', {
		bootstrapped: bootstrapResult.value,
		stateBranchRoot,
	});

	logger.info('[sync] checking state branch git operation', {
		stateBranchRoot,
	});

	const stateOpResult = trace(
		'hasInProgressGitOperation(stateBranchRoot)',
		await hasInProgressGitOperation(stateBranchRoot),
	);
	if (isFail(stateOpResult)) return failed(stateOpResult.message);

	logger.info('[sync] state branch git operation check result', {
		inProgress: stateOpResult.value,
	});

	if (stateOpResult.value) {
		logger.info('[sync] state branch git operation in progress');
		return failed(
			'Cannot sync while a git operation is in progress in the state branch',
		);
	}

	logger.info('[sync] ensuring state branch layout', {
		repoRoot,
		stateBranchRoot,
	});

	const layoutResult = trace(
		'ensureStateBranchLayout',
		ensureStateBranchLayout(repoRoot, stateBranchRoot),
	);
	if (isFail(layoutResult)) return failed(layoutResult.message);

	logger.info('[sync] state branch layout ready');

	logger.info('[sync] ensureSyncReady:done', {
		repoRoot,
		stateBranchRoot,
		bootstrapped: bootstrapResult.value,
	});

	return succeeded('Sync preconditions satisfied', {
		repoRoot,
		stateBranchRoot,
		bootstrapped: bootstrapResult.value,
	});
};

const commitOwnEventFileToStateBranch = async ({
	repoRoot,
	stateBranchRoot,
	ownEventFileName,
}: {
	repoRoot: string;
	stateBranchRoot: string;
	ownEventFileName: string;
}): Promise<Result<SyncOwnFileCommitResult>> => {
	logger.info('[sync] committing own event file from state branch', {
		ownEventFileName,
		stateBranchRoot,
	});

	logger.info('[sync] staging own event file', {
		stateBranchRoot,
		ownEventFileName,
	});

	const stageResult = trace(
		'stageStateBranchOwnEventFile',
		await stageStateBranchOwnEventFile({
			stateBranchRoot,
			eventFileName: ownEventFileName,
		}),
	);
	if (isFail(stageResult)) return failed(stageResult.message);

	const changedAfterStageResult = trace(
		'hasStagedChanges(after stage)',
		await hasStagedChanges(stateBranchRoot),
	);
	if (isFail(changedAfterStageResult)) {
		return failed(changedAfterStageResult.message);
	}

	logger.info('[sync] state branch change check after stage result', {
		changed: changedAfterStageResult.value,
	});

	if (!changedAfterStageResult.value) {
		logger.info('[sync] no own event file changes to commit');
		return succeeded('No own event file changes to commit', {
			createdCommit: false,
		});
	}

	logger.info('[sync] creating sync commit');

	const commitResult = trace(
		'createStateBranchSyncCommit',
		await createStateBranchSyncCommit({
			repoRoot,
			stateBranchRoot,
		}),
	);
	if (isFail(commitResult)) return failed(commitResult.message);

	logger.info('[sync] created sync commit', commitResult.value);

	return succeeded('Committed own event file', {
		createdCommit: true,
		commitSha: commitResult.value,
	});
};

export const syncEpiqWithRemote = async ({
	cwd = process.cwd(),
	ownEventFileName,
}: SyncArgs): Promise<Result<SyncSummary>> => {
	// ============================
	// Abort-guards
	// ============================
	logger.info('[sync] syncEpiqWithRemote:start', {
		cwd,
		ownEventFileName,
	});

	if (ownEventFileName.includes('/') || ownEventFileName.includes('\\')) {
		logger.info('[sync] invalid own event file name: contains path separator', {
			ownEventFileName,
		});
		return failed('Own event file must be a file name, not a path');
	}

	if (!ownEventFileName.endsWith('.jsonl')) {
		logger.info('[sync] invalid own event file name: missing .jsonl suffix', {
			ownEventFileName,
		});
		return failed('Own event file must end with .jsonl');
	}

	// ============================
	// Update state
	// ============================
	setSyncing('Syncing');

	// ============================
	// Ensure ready
	// ============================
	const ready = trace(
		'ensureSyncReady',
		await ensureSyncReady({
			cwd,
			ensureUpstream: true,
		}),
	);
	if (isFail(ready)) return failSync(ready.message);

	const {repoRoot, stateBranchRoot, bootstrapped} = ready.value;

	// ============================
	// Block on detached head
	// ============================
	const detachedResult = trace(
		'isDetachedHead(stateBranchRoot)',
		await isDetachedHead(stateBranchRoot),
	);
	if (isFail(detachedResult)) return failSync(detachedResult.message);

	logger.info('[sync] detached state branch check result', {
		detached: detachedResult.value,
	});

	if (detachedResult.value) {
		return failSync(
			'Cannot run :sync while the state branch is in detached HEAD state',
		);
	}

	let createdCommit = false;
	let commitSha: string | undefined;
	let pulled = false;
	let pushed = false;

	// ============================
	// Commit local events before remote sync
	// ============================
	const stateBranchResult = trace('getStateBranch', getStateBranch(repoRoot));
	if (isFail(stateBranchResult)) return failSync(stateBranchResult.message);

	const stateBranch = stateBranchResult.value;

	logger.info('[sync] resolved state branch', {
		stateBranch,
		stateBranchRoot,
	});

	const localCommitResult = trace(
		'commitOwnEventFileToStateBranch',
		await commitOwnEventFileToStateBranch({
			repoRoot,
			stateBranchRoot,
			ownEventFileName,
		}),
	);
	if (isFail(localCommitResult)) return failSync(localCommitResult.message);

	createdCommit = localCommitResult.value.createdCommit;
	commitSha = localCommitResult.value.commitSha;

	// ============================
	// Pull remote
	// ============================
	const pullResult = trace(
		'pullBranchRebaseIfPresent',
		await pullBranchRebaseIfPresent({
			cwd: stateBranchRoot,
			branch: stateBranch,
		}),
	);
	if (isFail(pullResult)) return failSync(pullResult.message);

	pulled = pullResult.value;

	// ============================
	// Push remote
	// ============================
	if (createdCommit || bootstrapped) {
		logger.info('[sync] pushing state branch', {
			createdCommit,
			bootstrapped,
			stateBranchRoot,
		});

		let pushResult = trace(
			'pushStateBranch',
			await pushStateBranch({stateBranchRoot, repoRoot}),
		);

		if (isFail(pushResult) && isNonFastForward(pushResult.message)) {
			const pullRetryResult = trace(
				'pullBranchRebaseIfPresent(retry)',
				await pullBranchRebaseIfPresent({
					cwd: stateBranchRoot,
					branch: stateBranch,
				}),
			);
			if (isFail(pullRetryResult)) return failSync(pullRetryResult.message);

			pulled = pulled || pullRetryResult.value;

			pushResult = trace(
				'pushStateBranch(retry)',
				await pushStateBranch({stateBranchRoot, repoRoot}),
			);
		}

		if (isFail(pushResult)) return failSync(pushResult.message);

		pushed = pushResult.value;
	}

	// ============================
	// Resolve commit sha
	// ============================
	if (createdCommit) {
		logger.info('[sync] resolving final sync commit sha', {
			stateBranchRoot,
		});

		const finalShaResult = trace(
			'git rev-parse HEAD',
			await execGit({
				args: ['rev-parse', 'HEAD'],
				cwd: stateBranchRoot,
			}),
		);

		if (isFail(finalShaResult)) {
			return failSync(finalShaResult.message);
		}

		commitSha = finalShaResult.value.stdout.trim();

		logger.info('[sync] final sync commit sha', commitSha);
	}

	// ============================
	// Update state
	// ============================
	setSynced(
		pushed
			? 'Synced and pushed'
			: pulled || createdCommit
			? 'Synced local state'
			: 'Already synced',
	);

	logger.info('[sync] syncEpiqWithRemote:done');

	return succeeded('Synced event logs with state branch', {
		repoRoot,
		stateBranchRoot,
		createdCommit,
		commitSha,
		pulled,
		pushed,
		bootstrapped,
	});
};

export const syncAndReloadState = async () => {
	const modeFail = failReloadIfNotDefaultMode();
	if (modeFail) return modeFail;

	logger.info('[sync] syncAndReloadState:start');

	const userRes = trace('resolveActorId', resolveActorId());
	if (isFail(userRes) || !userRes.value) {
		logger.info('[sync] unable to resolve actor id');
		return failed('Unable to resolve event log path');
	}

	const ownEventFileName = getPersistFileName(userRes.value);

	logger.info('[sync] resolved own event file name', {
		ownEventFileName,
	});

	const syncResult = trace(
		'syncEpiqWithRemote',
		await syncEpiqWithRemote({ownEventFileName}),
	);
	if (isFail(syncResult)) {
		logger.info('[sync] syncAndReloadState:sync failed', syncResult.message);
		return failed(`Unable to sync state. ${syncResult.message}`);
	}

	const {stateBranchRoot} = syncResult.value;

	logger.info('[sync] loading merged events after sync', {
		stateBranchRoot,
	});

	const allLoadedEventsResult = trace(
		'loadMergedEvents',
		loadMergedEvents(stateBranchRoot),
	);
	if (isFail(allLoadedEventsResult)) {
		return failed(`Unable to load events. ${allLoadedEventsResult.message}`);
	}

	logger.info('[sync] loaded merged events after sync', {
		count: allLoadedEventsResult.value.length,
	});

	const lateModeFail = failReloadIfNotDefaultMode();
	if (lateModeFail) return lateModeFail;

	const navigationAnchor = captureNavigationAnchor();

	const bootResult = trace(
		'bootStateFromEventLog',
		bootStateFromEventLog(allLoadedEventsResult.value),
	);
	if (isFail(bootResult)) {
		return failed(`Unable to boot synced state. ${bootResult.message}`);
	}

	logger.info('[sync] booted state from synced events');

	patchState({
		hasProjectDefinition: true,
		syncStatus: {
			msg: 'Synced',
			status: 'synced',
		},
	});

	const restoreResult = trace(
		'restoreNavigationAnchor',
		restoreNavigationAnchor(navigationAnchor),
	);
	if (isFail(restoreResult)) return restoreResult;

	logger.info('[sync] syncAndReloadState:done');

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
