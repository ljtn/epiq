#!/usr/bin/env node
import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import App from './app.js';
import {initProject} from './InitView.js';
import {playEvent} from './event/play.event.js';
import {navigationUtils} from './lib/actions/default/navigation-action-utils.js';
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
		// const workspace = storage.loadWorkspace();
		// const workspace = nodeBuilder.workspace('Workspace');
		// initWorkspaceState(workspace);

		const eventLog = [];
		if (!eventLog.length) {
			const workspace = playEvent({
				action: 'init.workspace',
				payload: {name: 'Workspace'},
			}).data;
			const board = playEvent({
				action: 'add.board',
				payload: {name: 'Default', parent: workspace},
			}).data;
			const [firstLane] = ['To do', 'Review', 'Done'].map(
				name =>
					playEvent({
						action: 'add.swimlane',
						payload: {name, parent: board},
					}).data,
			);
			if (!firstLane) return logger.error('Workspace initialization failed');

			navigationUtils.navigate({currentNode: firstLane, selectedIndex: 0});
		}

		mountApp();
		initListeners();
	}
})();
