#!/usr/bin/env node
import './debug-logger.js';
import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import App from './app.js';
import {initListeners} from './lib/navigation/keypress-listener.js';
import {appState, initWorkspaceState} from './lib/navigation/state/state.js';
import {initProject} from './init-project.js';
import {loadWorkspace} from './lib/storage/storage-manager.js';

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
			init: {
				type: 'string',
			},
		},
	},
);
cli;

export let renderWorkspace = () => {
	render(<App workspace={appState.rootNode} />);
};

process.stdout.on('resize', () => renderWorkspace());

(() => {
	console.clear();
	if (cli.flags.init) {
		initProject();
	} else if (!Object.keys(cli.flags).length) {
		const workspace = loadWorkspace();
		if (!workspace) {
			console.error('Failed to load workspace.');
			return;
		}
		initWorkspaceState(workspace);
		initListeners();
	}
})();
