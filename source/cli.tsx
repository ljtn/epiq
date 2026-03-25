#!/usr/bin/env node
import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import {ulid} from 'ulid';
import App from './app.js';
import {materializeAll} from './event/event-materialize.js';
import {initProject} from './InitView.js';
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
		const eventLog = [];
		if (!eventLog.length) {
			const workspaceId = ulid();
			const boardId = ulid();
			const allMaterialized = materializeAll([
				{
					action: 'init.workspace',
					payload: {id: workspaceId, name: 'Workspace'},
				},
				{
					action: 'add.board',
					payload: {id: boardId, name: 'Default', parentId: workspaceId},
				},
				{
					action: 'add.swimlane',
					payload: {id: ulid(), name: 'Todo', parentId: boardId},
				},
				{
					action: 'add.swimlane',
					payload: {id: ulid(), name: 'Review', parentId: boardId},
				},
				{
					action: 'add.swimlane',
					payload: {id: ulid(), name: 'Done', parentId: boardId},
				},
			]);

			navigationUtils.navigate({
				currentNode: allMaterialized.at(-1)?.data,
				selectedIndex: 1,
			});
		}

		mountApp();
		initListeners();
	}
})();
