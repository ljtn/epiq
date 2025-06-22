#!/usr/bin/env node
import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import App from './app.js';
import {BoardActions} from './lib/board/board-action-map.js';
import {navigate} from './lib/navigation.js';
import {navigationState} from './lib/state.js';
import {Board, Swimlane, Ticket} from './lib/types/board.model.js';
import {board} from './mock/board.js';
import {buildDefaultActions} from './lib/default-actions-routes.js';

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

export const main = () => {
	navigate({
		index: 0,
		breadCrumb: [board],
		callbacks: {
			render: () => {
				render(<App board={board} />);
			},
			onSelectChange: selected => {
				if (!selected) return;
				const type = (selected as Ticket | Swimlane | Board).actionContext; // Fix so that we can infer this type
				navigationState.availableActions = [
					...buildDefaultActions(),
					...BoardActions[type],
				];
			},
		},
	});
};

main();

process.stdout.on('resize', () => {
	render(<App board={board} />);
});
