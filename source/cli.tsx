#!/usr/bin/env node
import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import App from './app.js';
import {Hints} from './board/hints/hints.js';
import {board} from './board/mock/board.js';
import {Board, Swimlane, TicketListItem} from './board/model/board.model.js';
import {ContextualActionMap} from './navigation/actions/board-action-map.js';
import {inputActions} from './navigation/actions/input/input-actions.js';
import {DefaultActions} from './navigation/actions/default/default-actions.js';
import {navigate} from './navigation/navigation.js';
import {patchState, updateState} from './navigation/state/state.js';

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
(() => {
	console.clear();

	const onBeforeRender = () => {
		updateState(state => {
			const {currentNode, mode} = state;
			const hints = (currentNode && Hints[currentNode.actionContext + mode]) ??
				(currentNode && Hints[currentNode.actionContext]) ?? [''];
			return {
				...state,
				availableHints: hints as string[],
			};
		});
	};
	navigate({
		index: 0,
		breadCrumb: [board],
		callbacks: {
			render: () => {
				onBeforeRender();

				render(<App board={board} />);
			},
			onSelectChange: (selected, breadCrumb) => {
				// container is the "list" we are navigating in (board → swimlanes, swimlane → tickets, etc)
				const container = breadCrumb.at(-1)!;

				// still remember which *child* is selected for rendering
				const currentNode = selected ?? container;

				// but build actions from the container type, not the selected child
				const containerType = (container as TicketListItem | Swimlane | Board)
					.actionContext;

				patchState({
					currentNode,
					breadCrumb,
					availableActions: [
						...DefaultActions,
						...ContextualActionMap[containerType],
						...inputActions,
					],
				});
			},
		},
	});
})();

export let triggerRender = () => {
	render(<App board={board} />);
};

process.stdout.on('resize', () => {
	render(<App board={board} />);
});
