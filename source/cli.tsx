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
				if (!selected) return;
				const type = (selected as TicketListItem | Swimlane | Board)
					.actionContext; // Fix so that we can infer this type
				patchState({
					currentNode: selected,
					breadCrumb,
					availableActions: [
						...DefaultActions,
						...ContextualActionMap[type],
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
