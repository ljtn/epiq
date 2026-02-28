import {Box, Text} from 'ink';
import React from 'react';
import {Workspace} from '../model/context.model.js';
import {appState} from '../state/state.js';
import BoardList from './BoardList.js';
import {BoardUI} from './BoardUI.js';
import {Breadcrumb} from './BreadCrumb.js';

export const WorkspaceUI: React.FC<{workspace: Workspace}> = ({workspace}) => {
	return (
		<Box flexDirection="column">
			<Breadcrumb></Breadcrumb>

			<Box flexDirection="row">
				{appState.currentNode.context === 'WORKSPACE' ? (
					<BoardList workspace={workspace}></BoardList>
				) : appState.breadCrumb[1] ? (
					<BoardUI swimlanes={appState.breadCrumb[1].children} />
				) : (
					<Text></Text>
				)}
			</Box>
		</Box>
	);
};
