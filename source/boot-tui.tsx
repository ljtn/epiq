import {getStateBranchRoot} from './git/git-storage.js';
import {execGit} from './git/git-utils.js';
import {ensureStateBranchWorktree} from './git/git.js';
import {renderApp} from './Index.js';
import {loadSettingsFromConfig} from './lib/config/user-config.js';
import {bootStateFromEventLog} from './lib/event/event-boot.js';
import {loadMergedEvents} from './lib/event/event-load.js';
import {AppEvent} from './lib/event/event.model.js';
import {initListeners} from './lib/listeners/keypress-listener.js';
import {
	Result,
	isSuccess,
	isFail,
	succeeded,
} from './lib/model/result-types.js';
import {getProjectFileContents} from './lib/project-setup/project-setup.js';
import {patchSettingsState} from './lib/state/settings.state.js';
import {patchState} from './lib/state/state.js';
import {resolveClosestEpiqProjectRoot} from './lib/storage/paths.js';
import {failAt, formatUnknownError} from './lib/utils/logger.utils.js';

export async function bootTui(): Promise<Result<void>> {
	try {
		const settings = loadSettingsFromConfig();
		if (isSuccess(settings)) patchSettingsState(settings.value);

		const repoRootResult = resolveClosestEpiqProjectRoot(process.cwd());

		let eventLog: AppEvent[] = [];

		if (isSuccess(repoRootResult)) {
			const stateBranchRootResult = getStateBranchRoot({
				repoRoot: repoRootResult.value,
			});

			if (isFail(stateBranchRootResult)) {
				return failAt(3, stateBranchRootResult.message);
			}

			const projectFileContents = getProjectFileContents();

			const ensureWorktreeResult = await ensureStateBranchWorktree({
				repoRoot: repoRootResult.value,
				stateBranchRoot: stateBranchRootResult.value,
				stateBranchName: projectFileContents.stateBranch,
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

			const eventsResult = loadMergedEvents(stateBranchRootResult.value);
			if (isFail(eventsResult)) return failAt(3, eventsResult.message);

			eventLog = eventsResult.value;
		}

		const bootStateResult = bootStateFromEventLog(eventLog);
		if (isFail(bootStateResult)) return failAt(4, bootStateResult.message);

		patchState({
			hasProjectDefinition: isSuccess(repoRootResult),
			hasInitializingEvents: Boolean(eventLog.length),
		});

		const renderResult = renderApp();
		if (isFail(renderResult)) return failAt(6, renderResult.message);

		initListeners();

		return succeeded('Booted Epiq', undefined);
	} catch (error) {
		return failAt(0, formatUnknownError(error));
	}
}
