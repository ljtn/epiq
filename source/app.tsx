import {Box} from 'ink';
import React from 'react';
import {WorkspaceUI} from './lib/components/WorkspaceUI.js'; // Todo: the order of imports can apparently break the build
import {isSuccess} from './lib/command-line/command-types.js';
import {ContextBar} from './lib/components/ContextBar.js';
import {HelpUI} from './lib/components/Help.js';
import {Mode} from './lib/model/action-map.model.js';
import {findInBreadCrumb} from './lib/model/app-state.model.js';
import {getRenderedChildren, getState, useAppState} from './lib/state/state.js';

type AppProps = {
	height: number;
	width: number;
};

export default function App({width, height}: AppProps) {
	const state = useAppState();
	const board = findInBreadCrumb(getState().breadCrumb ?? [], 'BOARD');
	if (isSuccess(board)) {
		const boardId = board.data.id;
		const numberOfSwimlanes = getRenderedChildren(boardId).length;
		const swimlanePart = 3;
		const swimlaneMaxWidth = Math.floor(width / swimlanePart);
		const swimlaneDynamicWidth = Math.floor(
			width / Math.max(numberOfSwimlanes, 1),
		);
		const colWidth = Math.min(swimlaneDynamicWidth, swimlaneMaxWidth);
		width = colWidth * Math.max(numberOfSwimlanes, swimlanePart); // Swimlanes are
	}

	return (
		<Box flexDirection="column">
			{state.mode !== Mode.HELP && (
				<WorkspaceUI
					width={width}
					height={height}
					currentNode={state.currentNode}
					selectedIndex={state.selectedIndex}
					breadCrumb={state.breadCrumb}
					viewMode={state.viewMode}
					mode={state.mode}
				/>
			)}

			{state.mode === Mode.HELP && <HelpUI width={width} />}

			{state.mode !== Mode.HELP && (
				<ContextBar
					width={width}
					mode={state.mode}
					availableHints={state.availableHints}
				/>
			)}
		</Box>
	);
}
