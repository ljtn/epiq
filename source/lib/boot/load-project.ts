import {getStateBranchRoot} from '../../git/git-storage.js';
import {execGit} from '../../git/git-utils.js';
import {ensureStateBranchWorktree} from '../../git/git.js';
import {recordRecentProject} from '../config/recent-projects.js';
import {bootStateFromEventLog} from '../event/event-boot.js';
import {loadMergedEventsWithUnreadable} from '../event/event-load.js';
import {Result, isFail, succeeded} from '../model/result-types.js';
import {getProjectFileContents} from '../project-setup/project-setup.js';
import {patchState} from '../state/state.js';
import {failAt} from '../utils/logger.utils.js';

/**
 * Boots the app state from the project at `repoRoot`: ensures its state
 * worktree, pulls what it can, and materialises the event log. Shared by the
 * initial TUI boot and by `:open`, which switches into another project.
 */
export const loadProject = async (repoRoot: string): Promise<Result<void>> => {
	const stateBranchRootResult = getStateBranchRoot({repoRoot});
	if (isFail(stateBranchRootResult)) {
		return failAt(3, stateBranchRootResult.message);
	}

	const ensureWorktreeResult = await ensureStateBranchWorktree({
		repoRoot,
		stateBranchRoot: stateBranchRootResult.value,
		stateBranchName: getProjectFileContents().stateBranch,
	});

	if (isFail(ensureWorktreeResult)) {
		return failAt(3, ensureWorktreeResult.message);
	}

	const pullResult = await execGit({
		cwd: stateBranchRootResult.value,
		args: ['pull', '--ff-only'],
	});

	if (isFail(pullResult)) {
		logger.info(3, pullResult.message);
	}

	const eventsResult = loadMergedEventsWithUnreadable(
		stateBranchRootResult.value,
	);
	if (isFail(eventsResult)) return failAt(3, eventsResult.message);

	const {events, unreadable} = eventsResult.value;

	const bootStateResult = bootStateFromEventLog(events, unreadable);
	if (isFail(bootStateResult)) return failAt(4, bootStateResult.message);

	patchState({
		hasProjectDefinition: true,
		hasInitializingEvents: Boolean(events.length),
	});

	// A convenience for the next boot outside a project; not worth failing
	// this one over.
	const recordResult = recordRecentProject({root: repoRoot});
	if (isFail(recordResult)) logger.info(recordResult.message);

	return succeeded('Loaded project', undefined);
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
