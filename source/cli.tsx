#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import App from './app.js';
import {navigate} from './lib/navigation.js';
import {board} from './mock/board.js';
import {Board, Swimlane, Ticket} from './lib/types/board.model.js';
import {navigationState} from './lib/state.js';
import {BoardActions} from './lib/action-map.js';
import {buildDefaultActions} from './lib/default-actions.js';

const cli = meow(
	`
	Usage
	  $ epiq

	Options∏
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

let allActions = [...buildDefaultActions()];

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
				allActions = [...buildDefaultActions(), ...BoardActions[type]];
				navigationState.availableActions = allActions;
			},
			actionMap: allActions,
		},
	});
};

main();

process.stdout.on('resize', () => {
	main();
});
