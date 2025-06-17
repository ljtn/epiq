import React from 'react';
import {BoardUI} from './components/Board.js';
import {Board} from './lib/types/board.model.js';
import {Box, Text} from 'ink';
import {navigationState} from './lib/state.js';

process.stdout.write('\x1B[2J\x1B[0f');

export default function App({board}: {board: Board}) {
	const width = process.stdout.columns || 120;
	const swimlaneWidth = Math.floor(width / board.children.length);
	const renderedWidth = swimlaneWidth * board.children.length;
	return (
		<Box flexDirection="column">
			<BoardUI board={board} swimlaneWidth={swimlaneWidth} />
			<Box
				flexDirection="column"
				paddingLeft={1}
				paddingRight={1}
				paddingBottom={1}
				borderColor="gray"
				borderStyle="round"
				width={renderedWidth}
			>
				<Text color="#333">ACTIONS:</Text>
				{navigationState.availableActions.map((action, index) => (
					<Text key={index} color="gray">
						{action.description}
					</Text>
				))}
			</Box>
		</Box>
	);
}
