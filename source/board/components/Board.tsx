import {Box, Text} from 'ink';
import React from 'react';
import {Board} from '../model/board.model.js';
import {BoardContentUI} from './Swimlanes.js';

export const BoardUI: React.FC<{board: Board; swimlaneWidth: number}> = ({
	board,
	swimlaneWidth,
}) => {
	return (
		<Box flexDirection="column">
			<Box padding={1} justifyContent="center">
				<Text>{board.name}</Text>
			</Box>

			<Box flexDirection="row">
				<BoardContentUI items={board.children} width={swimlaneWidth} />
			</Box>
		</Box>
	);
};
