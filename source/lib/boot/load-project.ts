import {getStateBranch} from '../../git/git-constants.js';
import {getStateBranchRoot} from '../../git/git-storage.js';
import {
	hasRemote,
	isRemoteUnreachable,
	pullBranchRebaseIfPresent,
} from '../../git/git-utils.js';
import {ensureStateBranchWorktree} from '../../git/git.js';
import {reloadStateFromEventLog} from '../../git/sync-and-reload-state.js';
import {withSyncLock} from '../../git/sync-lock.js';
import {withEventLogsIntact} from '../../git/sync.js';
import {readCommandHistory} from '../config/command-history.js';
import {recordRecentProject} from '../config/recent-projects.js';
import {bootStateFromEventLog} from '../board/board-boot.js';
import {loadMergedEventsWithUnreadable} from '../board/board-log.js';
import {accountFor, logSignature} from '../event/log-signature.js';
import {AppEvent} from '../board/board-events.model.js';
import {Result, failed, isFail, succeeded} from '../model/result-types.js';
import {getProjectFileContents} from '../project-setup/project-setup.js';
import {hydrateCommandHistory} from '../state/cmd.state.js';
import {patchState} from '../state/state.js';
import {
	failSync,
	setSynced,
	setSyncing,
	setSyncOffline,
} from '../state/sync-state.js';
import {resolveClosestEpiqProjectRoot} from '../storage/paths.js';
import {failAt, formatUnknownError} from '../utils/logger.utils.js';

// A log with no init event cannot boot: a contributor registration alone is
// what a clone holds before its first pull.
const hasWorkspaceInit = (events: AppEvent[]): boolean =>
	events.some(event => event.action === 'init.workspace');

// The sync's own pull, so an unpushed board or uncommitted lines don't fail a fast-forward.
const pullStateBranch = async (
	repoRoot: string,
	stateBranchRoot: string,
): Promise<Result<boolean>> => {
	const branchResult = getStateBranch(repoRoot);
	if (isFail(branchResult)) return failed(branchResult.message);

	return pullBranchRebaseIfPresent({
		cwd: stateBranchRoot,
		branch: branchResult.value,
	});
};

// `:open` moves the process to another project; a pull that was in flight
// when it did must not materialise the old one over it.
const isCurrentProject = (stateBranchRoot: string): boolean => {
	const rootResult = resolveClosestEpiqProjectRoot(process.cwd());
	if (isFail(rootResult)) return false;

	const currentResult = getStateBranchRoot({repoRoot: rootResult.value});

	return !isFail(currentResult) && currentResult.value === stateBranchRoot;
};

let loadingProject = false;

// For readers of the worktree that must not see a project mid-load: `:open`
// moves cwd first, and the load may pull.
export const isLoadingProject = (): boolean => loadingProject;

/**
 * Boots app state from the project at `repoRoot`, for the TUI and `:open`.
 * Pulls first only when there is no local log; otherwise `refreshProjectFromRemote` catches up.
 */
export const loadProject = async (repoRoot: string): Promise<Result<void>> => {
	loadingProject = true;

	try {
		return await loadProjectFrom(repoRoot);
	} finally {
		loadingProject = false;
	}
};

const loadProjectFrom = async (repoRoot: string): Promise<Result<void>> => {
	const stateBranchRootResult = getStateBranchRoot({repoRoot});
	if (isFail(stateBranchRootResult)) {
		return failAt(3, stateBranchRootResult.message);
	}

	const stateBranchRoot = stateBranchRootResult.value;

	const ensureWorktreeResult = await ensureStateBranchWorktree({
		repoRoot,
		stateBranchRoot,
		stateBranchName: getProjectFileContents().stateBranch,
	});

	if (isFail(ensureWorktreeResult)) {
		return failAt(3, ensureWorktreeResult.message);
	}

	// Before each read, never after — see log-signature.
	let signature = logSignature(stateBranchRoot);

	let eventsResult = loadMergedEventsWithUnreadable(stateBranchRoot);
	if (isFail(eventsResult)) return failAt(3, eventsResult.message);

	if (!hasWorkspaceInit(eventsResult.value.events)) {
		// Under the lock: this pull rebases, and an unclaimed rebase may be unwound by
		// another process. Held elsewhere, boot goes on with the local events.
		const pullResult = await withSyncLock({
			worktreeRoot: stateBranchRoot,
			operation: 'boot pull',
			fn: () =>
				withEventLogsIntact(stateBranchRoot, () =>
					pullStateBranch(repoRoot, stateBranchRoot),
				),
		});

		if (isFail(pullResult)) logger.info(3, pullResult.message);
		else if (pullResult.value === null) {
			logger.info(3, 'Another process holds the state worktree, skipped pull');
		} else if (isFail(pullResult.value)) {
			logger.info(3, pullResult.value.message);
		}

		signature = logSignature(stateBranchRoot);
		eventsResult = loadMergedEventsWithUnreadable(stateBranchRoot);
		if (isFail(eventsResult)) return failAt(3, eventsResult.message);
	}

	const {events, unreadable} = eventsResult.value;

	const bootStateResult = bootStateFromEventLog(events, unreadable);
	if (isFail(bootStateResult)) return failAt(4, bootStateResult.message);

	accountFor(stateBranchRoot, signature);

	patchState({
		hasProjectDefinition: true,
		hasInitializingEvents: Boolean(events.length),
	});

	// A convenience for the next boot outside a project; not worth failing
	// this one over.
	const recordResult = recordRecentProject({root: repoRoot});
	if (isFail(recordResult)) logger.info(recordResult.message);

	// This project's own command history, hydrated even on a failed read so the
	// previous project's commands never leak onto ↑.
	const historyResult = readCommandHistory({root: repoRoot});
	if (isFail(historyResult)) logger.info(historyResult.message);
	hydrateCommandHistory(isFail(historyResult) ? [] : historyResult.value);

	return succeeded('Loaded project', undefined);
};

/** Pulls the state branch under the sync lock and re-materialises only if it moved. */
export const refreshProjectFromRemote = async (
	repoRoot: string,
): Promise<Result<void>> => {
	const stateBranchRootResult = getStateBranchRoot({repoRoot});
	if (isFail(stateBranchRootResult)) {
		return failed(stateBranchRootResult.message);
	}

	const stateBranchRoot = stateBranchRootResult.value;

	const remoteResult = await hasRemote({repoRoot: stateBranchRoot});
	if (isFail(remoteResult)) return failed(remoteResult.message);
	if (!remoteResult.value) return succeeded('No remote to pull', undefined);

	const lockedResult = await withSyncLock({
		worktreeRoot: stateBranchRoot,
		operation: 'boot pull',
		fn: () =>
			withEventLogsIntact(stateBranchRoot, () => {
				setSyncing('Pulling');
				return pullStateBranch(repoRoot, stateBranchRoot);
			}),
	});
	if (isFail(lockedResult)) return failSync(lockedResult.message);

	if (lockedResult.value === null) {
		return succeeded('Another process holds the state worktree', undefined);
	}

	const movedResult = lockedResult.value;

	if (isFail(movedResult)) {
		if (isRemoteUnreachable(movedResult.message)) {
			setSyncOffline('Offline');
			return succeeded('Offline', undefined);
		}

		return failSync(movedResult.message);
	}

	if (!movedResult.value) {
		setSynced('Already synced');
		return succeeded('Already synced', undefined);
	}

	if (!isCurrentProject(stateBranchRoot)) {
		return succeeded('Project changed during the pull', undefined);
	}

	// Sets the pill itself on every way it can fail.
	const reloadResult = reloadStateFromEventLog(stateBranchRoot);
	if (isFail(reloadResult)) return reloadResult;

	setSynced('Pulled');

	return succeeded('Pulled and reloaded', undefined);
};

/** For callers that must not wait on the network; the outcome goes to the log. */
export const refreshProjectInBackground = (repoRoot: string): void => {
	void refreshProjectFromRemote(repoRoot)
		.then(result => {
			if (isFail(result)) logger.info(3, result.message);
		})
		.catch(error => {
			logger.error(`[boot] pull failed: ${formatUnknownError(error)}`);
		});
};

export const loadWithoutProject = (): Result<void> => {
	const bootStateResult = bootStateFromEventLog([]);
	if (isFail(bootStateResult)) return failAt(4, bootStateResult.message);

	patchState({
		hasProjectDefinition: false,
		hasInitializingEvents: false,
	});

	return succeeded('Booted without a project', undefined);
};
