import chalk from 'chalk';
import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import {ensureStateBranchWorktree} from './git/git.js';
import {getStateBranchRoot} from './git/git-storage.js';
import {execGit} from './git/git-utils.js';
import {startGui} from './gui/init.js';
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
import {getProjectFileContents} from './lib/project-setup/project-setup.js';
import {patchSettingsState} from './lib/state/settings.state.js';
import {patchState} from './lib/state/state.js';
import {initUiState} from './lib/state/ux-state.js';
import {resolveClosestEpiqProjectRoot} from './lib/storage/paths.js';
import {failAt, formatUnknownError} from './lib/utils/logger.utils.js';
import './logger.js';

initUiState();

const helpText = `${chalk.bold('Epiq CLI')}

${chalk.dim('Boot in directory:')}
  ${chalk.cyan('$ epiq')}

`;

const cli = meow(helpText, {
	importMeta: import.meta,
	flags: {
		init: {
			type: 'boolean',
			default: false,
		},
		gui: {
			type: 'boolean',
			default: false,
		},
	},
});

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

process.stdout.on('resize', () => {
	width = process.stdout.columns || 120;
	height = process.stdout.rows || 20;

	if (!ink) return;

	const renderResult = renderApp();

	if (isFail(renderResult)) {
		logger.info(`[boot:resize] ${renderResult.message}`);
	}
});

if (cli.flags.gui) {
	const guiResult = await startGui({repoRoot: process.cwd()});

	if (isFail(guiResult)) {
		console.error(chalk.red(`Failed to start Epiq GUI:\n${guiResult.message}`));
		process.exitCode = 1;
	}
} else {
	console.clear();

	const bootResult = await bootApp();

	if (isFail(bootResult)) {
		logger.info(bootResult.message);
		console.error(chalk.red(`Failed to boot Epiq:\n${bootResult.message}`));
		process.exitCode = 1;
	}
}
