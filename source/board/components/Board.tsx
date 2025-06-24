import {Box, Text, useApp, useInput} from 'ink';
import React from 'react';
import {Board} from '../model/board.model.js';
import {SwimlanesUI} from './Swimlanes.js';

export const BoardUI: React.FC<{board: Board; swimlaneWidth: number}> = ({
	board,
	swimlaneWidth,
}) => {
	const {exit} = useApp();

	useInput((input, key) => {
		if (key.escape || input === 'q') {
			exit();
		}
	});

	return (
		<Box flexDirection="column">
			<Box padding={1} justifyContent="center">
				<Text>--- {board.name} ---</Text>
			</Box>

			<Box flexDirection="row">
				<SwimlanesUI items={board.children} width={swimlaneWidth} />
			</Box>
		</Box>
	);
};
