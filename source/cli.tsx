#!/usr/bin/env node
import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import App from './app.js';
import './debug-logger.js';
import {initListeners} from './navigation/keypress-listener.js';
import {appState, initAppState} from './navigation/state/state.js';
import {board} from './board/mock/board.js';

const cli = meow(
	`
	Usage
	  $ epiq

	Options
		--name  Your name

	Examples
	  $ epiq --name=Jane
	  Hello, Jane
`,
	{
		importMeta: import.meta,
		flags: {
			name: {
				type: 'string',
			},
		},
	},
);
cli;

export let triggerRender = () => {
	render(<App board={appState.rootNode!} />);
};

process.stdout.on('resize', () => triggerRender());

(() => {
	console.clear();
	initAppState(board);
	initListeners();
})();
