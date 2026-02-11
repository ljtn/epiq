#!/usr/bin/env node
import './debug-logger.js';
import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import App from './app.js';
import {initListeners} from './navigation/keypress-listener.js';
import {appState, initAppState} from './navigation/state/state.js';
import {board} from './board/mock/board.js';
import {initProject} from './init-project.js';

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

export let renderBoard = () => {
	render(<App board={appState.rootNode} />);
};

process.stdout.on('resize', () => renderBoard());

(() => {
	debug(cli);
	if (cli.flags.init) {
		initProject();
	} else if (!Object.keys(cli.flags).length) {
		initAppState(board);
		initListeners();
	}
})();
