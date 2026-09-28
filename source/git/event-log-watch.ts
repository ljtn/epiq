import {isLoadingProject} from '../lib/boot/load-project.js';
import {accountedSignature, logSignature} from '../lib/event/log-signature.js';
import {Mode} from '../lib/model/action-map.model.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {getSafeState, isStateInitialized} from '../lib/state/state.js';
import {resolveClosestEpiqProjectRoot} from '../lib/storage/paths.js';
import {logger} from '../logger.js';
import {getStateBranchRoot} from './git-storage.js';
import {isSyncLockHeldAt} from './sync-lock.js';
import {reloadStateFromEventLog} from './sync-and-reload-state.js';

const resolveStateBranchRoot = (): Result<string | null> => {
	const repoRootResult = resolveClosestEpiqProjectRoot(process.cwd());
	if (isFail(repoRootResult)) return succeeded('No project here', null);

	return getStateBranchRoot({repoRoot: repoRootResult.value});
};

/**
 * Re-materialises the board when the log on disk has moved past what this
 * process applied. Other processes on this machine (an MCP server, the GUI, a
 * second TUI) append to the same worktree without telling anyone.
 *
 * Compared against `accountedSignature`, so this process's own writes, which
 * `noteOwnAppend` accounts for, never trigger a reload.
 */
export const reloadIfEventLogMoved = async (): Promise<Result<null>> => {
	const rootResult = resolveStateBranchRoot();
	if (isFail(rootResult)) return failed(rootResult.message);
	if (rootResult.value === null) return succeeded('No project here', null);

	const stateBranchRoot = rootResult.value;
	const syncLocked = await isSyncLockHeldAt(stateBranchRoot);

	// Everything below is synchronous, so nothing can change between these
	// checks and the reload.
	if (!isStateInitialized()) return succeeded('State not initialized', null);

	const stateResult = getSafeState();
	if (isFail(stateResult)) return succeeded('State not initialized', null);

	const {mode, readOnly, timeMode, syncStatus, selectedNode, contextNode} =
		stateResult.value;

	if (isLoadingProject()) return succeeded('Project loading', null);

	const currentRoot = resolveStateBranchRoot();
	if (isFail(currentRoot) || currentRoot.value !== stateBranchRoot) {
		return succeeded('Project changed', null);
	}

	// Nothing is accounted for while skipped, so the next pass asks again.
	if (mode !== Mode.DEFAULT || readOnly || timeMode !== 'live') {
		return succeeded('Skipped while not on the live board', null);
	}

	// The reload reads the log but will not replay onto a virtual node, so
	// checking here saves a full read per tick until the cursor moves.
	if (selectedNode?.isVirtual || contextNode?.isVirtual) {
		return succeeded('Skipped on a virtual node', null);
	}

	// The sync reloads when it finishes.
	if (syncStatus?.status === 'syncing') {
		return succeeded('Sync in progress', null);
	}

	// Git may have lines off the logs until `withEventLogsIntact` restores them.
	// Not held during the read: sibling syncs never wait, so they would skip.
	if (syncLocked) {
		return succeeded('Worktree held by a sync', null);
	}

	if (logSignature(stateBranchRoot) === accountedSignature(stateBranchRoot)) {
		return succeeded('Log unchanged', null);
	}

	logger.debug('[watch] event log moved, reloading state');

	return reloadStateFromEventLog(stateBranchRoot);
};
