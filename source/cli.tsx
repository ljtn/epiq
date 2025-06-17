#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import App from './app.js';
import {navigate} from './lib/navigation.js';
import {board} from './mock/board.js';
import {Board, Swimlane, Ticket} from './lib/types/board.model.js';
import {navigationState} from './lib/state.js';
import {Actions} from './lib/action-map.js';

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

export const main = () => {
	navigate({
		breadCrumb: [board],
		callbacks: {
			render: () => {
				render(<App board={board} />);
			},
			onSelectChange: selected => {
				if (!selected) return;
				const type = (selected as Ticket | Swimlane | Board).type; // Fix so that we can infer this type
				navigationState.availableActions = Actions[type];
			},
		},
	});
};

main();

process.stdout.on('resize', () => {
	main();
});
