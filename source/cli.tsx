#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import App from './app.js';
import {navigate} from './lib/navigation.js';
import {board} from './mock/board.js';
import {Board} from './lib/types/board.model.js';

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

function renderBoard(board: Board) {
	render(<App board={board} />);
}

export const main = () => {
	navigate({
		breadCrumb: [board],
		callbacks: {
			render: () => {
				renderBoard(board);
			},
		},
	});
};

main();

process.stdout.on('resize', () => {
	renderBoard(board);
});
