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
				<Box>
					{[...rest].map((b, i) => (
						<Box>
							<Text>{i ? ' / ' : ''}</Text>
							<Text color={i === rest.length - 1 ? 'cyan' : 'gray'}>
								{b.name}
							</Text>
						</Box>
					))}
				</Box>
			</Box>

			<Box flexDirection="row">
				<BoardContentUI items={board.children} />
			</Box>
		</Box>
	);
};
