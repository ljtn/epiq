import {Box, useApp, useInput} from 'ink';
import React from 'react';
import {BoardUI} from './board/components/Board.js';
import {ContextBar} from './board/components/ContextBar.js';
import {HelpUI} from './board/components/Help.js';
import {Board} from './board/model/board.model.js';
import {navigationState} from './navigation/state/state.js';
import {Mode} from './navigation/model/action-map.model.js';

export default function App({board}: {board: Board}) {
	const {exit} = useApp();

	useInput((input, key) => {
		if (key.escape || input === 'q') {
			exit();
		}
	});
	const width = process.stdout.columns || 120;
	const swimlaneWidth = Math.floor(width / board.children.length);
	const renderedWidth = swimlaneWidth * board.children.length;

	return (
		<Box flexDirection="column">
			{/* <Logo></Logo> */}
			{!(navigationState.mode === Mode.HELP) && (
				<>
					<BoardUI board={board} swimlaneWidth={swimlaneWidth} />
					<ContextBar width={renderedWidth} />
				</>
			)}

			{navigationState.mode === Mode.HELP && <HelpUI width={renderedWidth} />}
		</Box>
	);
}
