import {Box, Text, useApp, useInput} from 'ink';
import React from 'react';
import {Board} from '../lib/types/board.model.js';
import {SwimlaneUI} from './Swimlane.js';

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
			<Text>{board.name.toUpperCase()}</Text>

			<Box flexDirection="row">
				<SwimlaneUI items={board.children} width={swimlaneWidth} />
			</Box>
		</Box>
	);
};
