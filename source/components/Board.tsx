import {Box, Text, useApp, useInput} from 'ink';
import React from 'react';
import {Board} from '../lib/types/board.model.js';
import {SwimlaneUI} from './Swimlane.js';

export const BoardUI: React.FC<{board: Board}> = ({board}) => {
	const {exit} = useApp();
	const swimlanes = board.children;
	const totalWidth = process.stdout.columns || 120;
	const swimlaneWidth = Math.floor(totalWidth / swimlanes.length);

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
