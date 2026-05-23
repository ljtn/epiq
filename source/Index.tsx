import chalk from 'chalk';
import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import {getStateBranchRoot} from './git/git-storage.js';
import EpiqApp from './lib/components/EpiqApp.js';
import {loadSettingsFromConfig} from './lib/config/user-config.js';
import {bootStateFromEventLog} from './lib/event/event-boot.js';
import {loadMergedEvents} from './lib/event/event-load.js';
import {AppEvent} from './lib/event/event.model.js';
import {initListeners} from './lib/listeners/keypress-listener.js';
import {
	failed,
	isFail,
	isSuccess,
	Result,
	succeeded,
} from './lib/model/result-types.js';
import {patchSettingsState} from './lib/state/settings.state.js';
import {patchState} from './lib/state/state.js';
import {initUiState} from './lib/state/ux-state.js';
import {resolveClosestEpiqProjectRoot} from './lib/storage/paths.js';
import {failAt, formatUnknownError} from './lib/utils/logger.utils.js';
import './logger.js';
import {execGit} from './git/git-utils.js';
import {getProjectFileContents} from './lib/project-setup/project-setup.js';
import {ensureStateBranchWorktree} from './git/git.js';

initUiState();

meow(
	`${chalk.bold('Epiq CLI')}

${chalk.dim('Boot in directory:')}
  ${chalk.cyan('$ epiq')}

`,
	{
		importMeta: import.meta,
		flags: {
			init: {
				type: 'boolean',
				default: false,
			},
		},
	},
);

let width = process.stdout.columns || 120;
let height = process.stdout.rows || 20;
let ink: ReturnType<typeof render> | null = null;

const renderNode = (node: React.ReactNode): Result<void> => {
	try {
		if (!ink) {
			ink = render(node);
			return succeeded('Rendered app', undefined);
		}

		ink.rerender(node);
		return succeeded('Rerendered app', undefined);
	} catch (error) {
		return failed(`Unable to render app: ${formatUnknownError(error)}`);
	}
};

const renderApp = (): Result<void> =>
	renderNode(<EpiqApp width={width} height={height} />);

async function bootApp(): Promise<Result<void>> {
	try {
		// 1. Get settings
		const settings = loadSettingsFromConfig();
		if (isSuccess(settings)) patchSettingsState(settings.value);

		// 2. Locate repo root
		const repoRootResult = resolveClosestEpiqProjectRoot(process.cwd());

		let eventLog: AppEvent[] = [];
		if (isSuccess(repoRootResult)) {
			// 3.a Localize state branch root
			const stateBranchRootResult = getStateBranchRoot({
				repoRoot: repoRootResult.value,
			});
			if (isFail(stateBranchRootResult)) {
				return failAt(3, stateBranchRootResult.message);
			}

			// 3.b Ensure state branch worktree exists
			// In case the user has deleted the worktree folder
			// we want to recreate it so that we can load the remote events
			const projectFileContents = getProjectFileContents();
			const ensureWorktreeResult = await ensureStateBranchWorktree({
				repoRoot: repoRootResult.value,
				stateBranchRoot: stateBranchRootResult.value,
				stateBranchName: projectFileContents.stateBranch,
			});

			if (isFail(ensureWorktreeResult)) {
				return failAt(3, ensureWorktreeResult.message);
			}

			// 3.c Attempt pull latest state branch,
			// but don't fail if it doesn't work since we can still load local events
			const pullResult = await execGit({
				cwd: stateBranchRootResult.value,
				args: ['pull', '--ff-only'],
			});
			if (isFail(pullResult)) {
				logger.info(3, pullResult.message);
			}

			// 3.d Load events
			const eventsResult = loadMergedEvents(stateBranchRootResult.value);
			if (isFail(eventsResult)) return failAt(3, eventsResult.message);
			eventLog = eventsResult.value;
		}

		// 4. Boot state from events
		const bootStateResult = bootStateFromEventLog(eventLog);
		if (isFail(bootStateResult)) return failAt(4, bootStateResult.message);

		// 5. Set state
		patchState({
			hasProjectDefinition: isSuccess(repoRootResult),
			hasInitializingEvents: Boolean(eventLog.length),
		});

		// 6. Render app
		const renderResult = renderApp();
		if (isFail(renderResult)) return failAt(6, renderResult.message);

		initListeners();

		return succeeded('Booted Epiq', undefined);
	} catch (error) {
		return failAt(0, formatUnknownError(error));
	}
}

process.stdout.on('resize', () => {
	width = process.stdout.columns || 120;
	height = process.stdout.rows || 20;

	if (!ink) return;

	const renderResult = renderApp();
	if (isFail(renderResult))
		logger.info(`[boot:resize] ${renderResult.message}`);
});

void (async () => {
	console.clear();

	const bootResult = await bootApp();

	if (isFail(bootResult)) {
		logger.info(bootResult.message);
		console.error(chalk.red(`Failed to boot Epiq:\n${bootResult.message}`));
		process.exitCode = 1;
	}
})();
