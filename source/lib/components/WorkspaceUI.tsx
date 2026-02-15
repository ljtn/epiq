import {Box, Text} from 'ink';
import React from 'react';
import {appState} from '../navigation/state/state.js';
import {Workspace} from '../model/context.model.js';
import BoardList from './BoardList.js';
import {BoardUI} from './BoardUI.js';
import {theme} from '../theme/themes.js';

export const WorkspaceUI: React.FC<{workspace: Workspace}> = ({workspace}) => {
	const [...rest] = appState.breadCrumb;
	return (
		<Box flexDirection="column">
			<Box paddingLeft={1}>
				<Box>
					{[...rest].map((b, i) => (
						<Box key={i}>
							<Text>{i ? ' / ' : ''}</Text>
							<Text
								color={i === rest.length - 1 ? theme.accent : theme.secondary}
							>
								{b.name}
							</Text>
						</Box>
					))}
				</Box>
			</Box>

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
