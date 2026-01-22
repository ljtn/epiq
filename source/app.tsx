import {Box} from 'ink';
import React from 'react';
import {BoardUI} from './board/components/Board.js';
import {ContextBar} from './board/components/ContextBar.js';
import {HelpUI} from './board/components/Help.js';
import {Board} from './board/model/board.model.js';
import {Mode} from './navigation/model/action-map.model.js';
import {navigationState} from './navigation/state/state.js';

export default function App({board}: {board: Board}) {
	const width = process.stdout.columns || 120;
	const swimlaneMaxWidth = Math.floor(process.stdout.columns / 3);
	const swimlaneDynamicWidth = Math.floor(width / board.children.length);
	const renderedWidth = swimlaneDynamicWidth * board.children.length;
	const swimlaneWidth = Math.min(renderedWidth, swimlaneMaxWidth);

	return (
		<Box flexDirection="column">
			{/* <Logo></Logo> */}
			{!(navigationState.mode === Mode.HELP) && (
				<BoardUI board={board} swimlaneWidth={swimlaneWidth} />
			)}
			{navigationState.mode === Mode.HELP && <HelpUI width={renderedWidth} />}
			<ContextBar width={width} />
		</Box>
	);
}
