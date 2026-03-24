#!/usr/bin/env node
import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import App from './app.js';
import {initProject} from './InitView.js';
import {
	addBoard,
	addSwimlane,
	addWorkspace,
} from './lib/actions/add-item/add-item-actions.js';
import {initListeners} from './lib/listeners/keypress-listener.js';
import {initWorkspaceState} from './lib/state/state.js';
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
		// const workspace = storage.loadWorkspace();
		// if (!workspace) {
		// 	logger.error('Failed to load workspace.');
		// 	return;
		// }
		logger.info('a');
		const workspace = addWorkspace('Workspace').data;
		if (!workspace) return;
		logger.info('b');

		const board = addBoard(workspace, 'Default').data;
		if (!board) return;
		logger.info('c');

		const swimlanes = ['To do', 'Review', 'Done']
			.map(name => addSwimlane(board, name).data)
			.filter((x): x is NonNullable<typeof x> => !!x);
		logger.info('d');

		if (swimlanes.length !== 3) return;

		logger.info('e');
		const nodes = Object.fromEntries(
			[workspace, board, ...swimlanes].map(node => [node.id, node]),
		);
		logger.info('f', nodes);

		workspace.children.push(board.id);
		board.children = swimlanes.map(({id}) => id);

		initWorkspaceState(nodes, workspace.id);

		mountApp();
		initListeners();
	}
})();
