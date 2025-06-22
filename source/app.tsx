import {Box} from 'ink';
import React from 'react';
import {BoardUI} from './board/components/Board.js';
import {HelpUI} from './board/components/Help.js';
import {Board} from './board/model/board.model.js';

process.stdout.write('\x1B[2J\x1B[0f');

export default function App({board}: {board: Board}) {
	const width = process.stdout.columns || 120;
	const swimlaneWidth = Math.floor(width / board.children.length);
	const renderedWidth = swimlaneWidth * board.children.length;

	return (
		<Box flexDirection="column">
			<BoardUI board={board} swimlaneWidth={swimlaneWidth} />
			<HelpUI width={renderedWidth}></HelpUI>
		</Box>
	);
}
