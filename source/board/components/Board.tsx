import {Box, Text} from 'ink';
import React from 'react';
import {appState} from '../../navigation/state/state.js';
import {Board} from '../model/context.model.js';
import {BoardContentUI} from './Swimlanes.js';

export const BoardUI: React.FC<{board: Board}> = ({board}) => {
	const [_, ...rest] = appState.breadCrumb;
	return (
		<Box flexDirection="column">
			<Box paddingLeft={1}>
				<Text color={'gray'}>
					{[...rest].map((b, i) => (i ? ' / ' : '') + b.name)}
				</Text>
			</Box>

			<Box flexDirection="row">
				<BoardContentUI items={board.children} />
			</Box>
		</Box>
	);
};
