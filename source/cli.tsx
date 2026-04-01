import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import App from './app.js';
import {bootStateFromEventLog} from './event/event-boot.js';
import {initProject} from './InitView.js';
import {initListeners} from './lib/listeners/keypress-listener.js';
import './logger.js';

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

const mountApp = () => {
	if (!ink) {
		ink = render(<App />);
	} else {
		ink.rerender(<App />);
	}
};

process.stdout.on('resize', () => {
	if (ink) ink.rerender(<App />);
});

(() => {
	console.clear();
	if (cli.flags.init) {
		initProject();
		return;
	}

	if (!Object.keys(cli.flags).length) {
		bootStateFromEventLog();
		mountApp();
		initListeners();
	}
})();
