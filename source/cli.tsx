import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import App from './app.js';
import {bootStateFromEventLog} from './event/event-boot.js';
import {loadMergedEvents} from './event/event-load.js';
import {syncEpiqFromRemote} from './git/sync.js';
import {isFail} from './lib/command-line/command-types.js';
import Logo from './lib/components/Logo.js';
import {loadSettingsFromConfig} from './lib/config/user-config.js';
import {initListeners} from './lib/listeners/keypress-listener.js';
import './logger.js';

meow(
	`
  View board in directory:
  $ epiq

  Init project in directory:
  $ epiq --init "Project Name"
`,
	{
		importMeta: import.meta,
		flags: {
			init: {type: 'string'},
		},
	},
);

const FIRST_LOAD_DURATION_MS = 2_000;
const SUBSEQUENT_LOAD_MAX_MS = 600;

let width = process.stdout.columns || 120;
let height = process.stdout.rows || 20;
let ink: ReturnType<typeof render> | null = null;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

const renderLoader = (durationMs: number) => {
	renderNode(<Logo durationMs={durationMs} />);
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
	loadSettingsFromConfig();

	await syncEpiqFromRemote();

	const eventLog = loadEventLogOrExit();
	const isFirstLoad = eventLog.length === 0;
	const loaderDurationMs = isFirstLoad
		? FIRST_LOAD_DURATION_MS
		: SUBSEQUENT_LOAD_MAX_MS;

	if (loaderDurationMs > 0) {
		renderLoader(loaderDurationMs);
	}

	const startedAt = Date.now();
	bootStateOrExit(eventLog);
	const bootElapsedMs = Date.now() - startedAt;

	const remainingLoaderTime = Math.max(0, loaderDurationMs - bootElapsedMs);
	if (remainingLoaderTime > 0) {
		await sleep(remainingLoaderTime);
	}

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
