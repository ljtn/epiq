import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import App from './app.js';
import {loadMergedEvents} from './event/event-load.js';
import {initProject} from './InitView.js';
import Logo from './lib/components/Logo.js';
import {initListeners} from './lib/listeners/keypress-listener.js';
import './logger.js';
import {bootStateFromEventLog} from './event/event-boot.js';
import {loadSettingsFromConfig} from './lib/config/load-settings.js';

const cli = meow(
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

let width = process.stdout.columns || 120;
let height = process.stdout.rows || 20;
const FIRST_LOAD_DURATION_MS = 5_000;
const SUBSEQUENT_LOAD_MAX_MS = 0;

let ink: ReturnType<typeof render> | null = null;

function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function renderApp() {
	if (!ink) {
		ink = render(<App width={width} height={height} />);
		return;
	}

	ink.rerender(<App width={width} height={height} />);
}

function renderLoader() {
	if (!ink) {
		ink = render(<Logo durationMs={2_000} />);
		return;
	}

	ink.rerender(<Logo durationMs={2_000} />);
}

async function bootApp() {
	loadSettingsFromConfig();

	const eventLog = loadMergedEvents();
	const isFirstLoad = eventLog.length === 0;
	const loaderDurationMs = isFirstLoad
		? FIRST_LOAD_DURATION_MS
		: SUBSEQUENT_LOAD_MAX_MS;

	if (loaderDurationMs > 0) {
		renderLoader();
	}

	const startedAt = Date.now();
	bootStateFromEventLog(eventLog);
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
	if (ink) ink.rerender(<App width={width} height={height} />);
});

(async () => {
	console.clear();

	if (cli.flags.init) {
		initProject();
		return;
	}

	await bootApp();
})();
