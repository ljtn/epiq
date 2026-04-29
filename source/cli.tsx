import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import App from './app.js';
import {bootStateFromEventLog} from './event/event-boot.js';
import {loadMergedEvents} from './event/event-load.js';
import {syncEpiqFromRemote} from './git/sync.js';
import {isFail} from './lib/command-line/command-types.js';
import {loadSettingsFromConfig} from './lib/config/user-config.js';
import {initListeners} from './lib/listeners/keypress-listener.js';
import './logger.js';

import chalk from 'chalk';
import {patchSettingsState} from './lib/state/settings.state.js';

meow(
	`${chalk.bold('Epiq CLI')}

${chalk.dim('Boot in directory:')}
  ${chalk.cyan('$ epiq')}

`,
	{
		importMeta: import.meta,
		flags: {
			init: {type: 'string'},
		},
	},
);

let width = process.stdout.columns || 120;
let height = process.stdout.rows || 20;
let ink: ReturnType<typeof render> | null = null;

const renderNode = (node: React.ReactNode) => {
	if (!ink) {
		ink = render(node);
		return;
	}

	ink.rerender(node);
};

const renderApp = () => {
	renderNode(<App width={width} height={height} />);
};

const loadEventLogOrExit = () => {
	const result = loadMergedEvents();

	if (isFail(result)) {
		const noEventsFound = result.message.includes('No events found');

		if (noEventsFound) {
			logger.info('No events found, starting with empty state');
			return [];
		}

		throw new Error(result.message);
	}

	return result.data;
};

const bootStateOrExit = (eventLog: ReturnType<typeof loadEventLogOrExit>) => {
	const result = bootStateFromEventLog(eventLog);

	if (isFail(result)) {
		throw new Error(`Failed to boot state: ${result.message}`);
	}
};

async function bootApp() {
	const settings = loadSettingsFromConfig();
	if (!isFail(settings)) {
		patchSettingsState(settings.data);
	}

	await syncEpiqFromRemote();

	const eventLog = loadEventLogOrExit();

	bootStateOrExit(eventLog);

	renderApp();
	initListeners();
}

process.stdout.on('resize', () => {
	width = process.stdout.columns || 120;
	height = process.stdout.rows || 20;

	if (ink) {
		renderApp();
	}
});

(async () => {
	console.clear();
	await bootApp();
})();
