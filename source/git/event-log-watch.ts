import {accountedSignature, logSignature} from '../lib/event/log-signature.js';
import {Mode} from '../lib/model/action-map.model.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {getSafeState, isStateInitialized} from '../lib/state/state.js';
import {resolveClosestEpiqProjectRoot} from '../lib/storage/paths.js';
import {logger} from '../logger.js';
import {getStateBranchRoot} from './git-storage.js';
import {reloadStateFromEventLog} from './sync-and-reload-state.js';

/**
 * Whether the board on screen still matches the log on disk — and a
 * re-materialise when it does not.
 *
 * A sync is not the only thing that moves the log: an MCP server, a GUI
 * autosync or a second TUI on this machine appends to the same worktree
 * without telling anybody, and a pull commits somebody else's lines into it.
 * Those events reach this board only when somebody notices the directory
 * moved — which is what `logSignature` exists to answer: a listing and a
 * stat per file, cheap enough to ask every second.
 *
 * The comparison is against `accountedSignature` — what this process has both
 * read and applied — so its own writes do not count: `persist` calls
 * `noteOwnAppend` and keeps the accounted signature current without a reload.
 */
export const reloadIfEventLogMoved = (): Result<null> => {
	if (!isStateInitialized()) return succeeded('State not initialized', null);

	const stateResult = getSafeState();
	if (isFail(stateResult)) return succeeded('State not initialized', null);

	const {mode, readOnly, timeMode, syncStatus} = stateResult.value;

	// Editing and time travel refuse a re-materialise rather than lose what
	// they are holding; nothing is accounted for, so the next pass asks again.
	if (mode !== Mode.DEFAULT || readOnly || timeMode !== 'live') {
		return succeeded('Skipped while not on the live board', null);
	}

	// A sync's own reload accounts for what it reads; running a second one
	// over a worktree it is mid-flight on only doubles the work.
	if (syncStatus?.status === 'syncing') {
		return succeeded('Sync in progress', null);
	}

	const repoRootResult = resolveClosestEpiqProjectRoot(process.cwd());
	if (isFail(repoRootResult)) return succeeded('No project here', null);

	const stateBranchRootResult = getStateBranchRoot({
		repoRoot: repoRootResult.value,
	});
	if (isFail(stateBranchRootResult))
		return failed(stateBranchRootResult.message);

	const stateBranchRoot = stateBranchRootResult.value;

	if (logSignature(stateBranchRoot) === accountedSignature(stateBranchRoot)) {
		return succeeded('Log unchanged', null);
	}

	logger.debug('[watch] event log moved, reloading state');

	return reloadStateFromEventLog(stateBranchRoot);
};
