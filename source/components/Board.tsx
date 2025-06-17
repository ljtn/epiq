import {Box, Text, render, useApp, useInput} from 'ink';
import React from 'react';
import {Board} from '../lib/types/board.model.js';
import {SwimlaneBox} from './SwimlaneBox.js';

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
		<Box borderStyle="single" flexDirection="column" padding={1}>
			<Text>{'   ' + board.name.toUpperCase()}</Text>

			<Box flexDirection="row" padding={1}>
				<SwimlaneBox
					items={board.children}
					width={swimlaneWidth}
					colSeparator="  |  "
					highlightIndex={1}
				/>
			</Box>
		</Box>
	);
};

// Entry point
export const renderBoard = (board: Board) => {
	render(<BoardUI board={board} />);
};
