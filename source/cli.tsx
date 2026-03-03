#!/usr/bin/env node
import './logger.js';
import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import App from './app.js';
import {initProject} from './InitView.js';
import {initListeners} from './lib/listeners/keypress-listener.js';
import {getState, initWorkspaceState} from './lib/state/state.js';
import {storageManager} from './lib/storage/storage-manager.js';
import {nodeMapper} from './lib/utils/node-mapper.js';

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
		ink = render(<App workspace={getState().rootNode} />);
	} else {
		ink.rerender(<App workspace={getState().rootNode} />);
	}
};

process.stdout.on('resize', () => {
	if (ink) ink.rerender(<App workspace={getState().rootNode} />);
});

(() => {
	console.clear();
	if (cli.flags.init) {
		initProject();
		return;
	}

	if (!Object.keys(cli.flags).length) {
		const workspace = storageManager.loadWorkspace();
		if (!workspace) {
			logger.error('Failed to load workspace.');
			return;
		}
		initWorkspaceState(nodeMapper.toWorkspace(workspace));
		mountApp();
		initListeners();
	}
})();
