import {Box, Text} from 'ink';
import React from 'react';
import {Workspace} from '../model/context.model.js';
import BoardList from './BoardList.js';
import {BoardUI} from './BoardUI.js';
import {Breadcrumb} from './BreadCrumb.js';
import {useAppState} from '../state/state.js';

export const WorkspaceUI: React.FC<{workspace: Workspace}> = ({workspace}) => {
	const appState = useAppState();

	const board =
		appState.breadCrumb.length >= 2 &&
		appState.breadCrumb[1]?.context === 'BOARD'
			? appState.breadCrumb[1]
			: undefined;

	return (
		<Box flexDirection="column">
			<Breadcrumb />

			<Box flexDirection="row">
				{appState.currentNode.context === 'WORKSPACE' ? (
					<BoardList workspace={workspace} />
				) : board ? (
					<BoardUI swimlanes={board.children} />
				) : (
					<Text />
				)}
			</Box>
		</Box>
	);
};
