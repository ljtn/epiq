import {syncEpiqWithRemote} from '../../git/sync.js';
import {getPersistFileName} from '../../lib/event/event-persist.js';
import {failed, isFail, succeeded} from '../../lib/model/result-types.js';
import {
	setSynced,
	setSyncFailed,
	setSyncing,
} from '../../lib/state/sync-state.js';
import {ToolInput, resolveRepoRoot, getActor} from './boot.js';

type SyncInput = ToolInput;

export const sync = async (input: SyncInput = {}) => {
	setSyncing();
	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed('Sync failed');

	const actor = getActor();
	if (isFail(actor)) return actor;

	const result = await syncEpiqWithRemote({
		cwd: repoRootResult.value,
		ownEventFileName: getPersistFileName(actor.value),
	});

	if (isFail(result)) {
		setSyncFailed(result.message);
		return result;
	}

	setSynced();
	return succeeded('Synced', result.value);
};
