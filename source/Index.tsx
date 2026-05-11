import chalk from 'chalk';
import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import {resetHardToRemoteState} from './git/sync.js';
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
import {resolveClosestEpiqProjectRoot} from './lib/storage/paths.js';
import {failAt, formatUnknownError} from './lib/utils/logger.utils.js';
import './logger.js';
import {initUiState} from './lib/state/ux-state.js';

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
			// 3.a Sync with remote state
			const repoRoot = repoRootResult.value;
			const syncResult = await resetHardToRemoteState(repoRoot);
			if (isFail(syncResult)) return failAt(3, syncResult.message);

			// 3.b Load events
			const eventsResult = loadMergedEvents(syncResult.value.stateBranchRoot);
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
