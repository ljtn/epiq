#!/usr/bin/env node
import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import App from './app.js';
import {navigate} from './navigation/navigation.js';
import {navigationState} from './navigation/state/state.js';
import {Board, Swimlane, Ticket} from './board/model/board.model.js';
import {buildDefaultActions} from './navigation/actions/default-actions-routes.js';
import {BoardActions} from './board/actions/board-action-map.js';
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

export const main = () => {
	console.clear();

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
