import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import App from './app.js';
import {bootStateFromEventLog} from './event/event-boot.js';
import {initProject} from './InitView.js';
import {initListeners} from './lib/listeners/keypress-listener.js';
import './logger.js';
import Logo from './lib/components/Logo.js';

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

let ink: ReturnType<typeof render> | null = null;

const renderApp = () => {
	if (!ink) {
		ink = render(<App />);
	} else {
		ink.rerender(<App />);
	}
};
const renderLoader = () => {
	if (!ink) {
		ink = render(<Logo />);
	} else {
		ink.rerender(<Logo />);
	}
};

const bootState = async () => {
	await new Promise((resolve, reject) => {
		try {
			const now = Date.now();
			bootStateFromEventLog();
			const bootTime = Date.now() - now;
			if (bootTime < 500) {
				// If boot is very fast, add a small delay to show the loader
				const newBootTime = 3_000 - bootTime;
				logger.debug(`Recalculating boot time with delay: ${newBootTime}ms`);
				setTimeout(() => resolve(null), newBootTime);
			} else {
				resolve(null);
			}
		} catch (error) {
			reject(error);
		}
	});
};

process.stdout.on('resize', () => {
	if (ink) ink.rerender(<App />);
});

(async () => {
	console.clear();
	if (cli.flags.init) {
		initProject();
		return;
	}

	if (!Object.keys(cli.flags).length) {
		renderLoader();
		await bootState();

		renderApp();

		initListeners();
	}
})();
