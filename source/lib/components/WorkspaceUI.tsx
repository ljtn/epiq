import {Box, Text} from 'ink';
import React from 'react';
import BoardList from './BoardList.js';
import {BoardUI} from './BoardUI.js';
import {Breadcrumb} from './BreadCrumb.js';
import {useAppState} from '../state/state.js';

export const WorkspaceUI: React.FC = () => {
	const state = useAppState();

	const board =
		state.breadCrumb.length >= 2 && state.breadCrumb[1]?.context === 'BOARD'
			? state.breadCrumb[1]
			: undefined;

	return (
		<Box flexDirection="column">
			<Breadcrumb />
			<Box flexDirection="row">
				{state.currentNode.context === 'WORKSPACE' ? (
					<BoardList />
				) : board ? (
					<BoardUI swimlanes={board.children} />
				) : (
					<Text />
				)}
			</Box>
		</Box>
	);
};
