import {Box} from 'ink';
import React from 'react';
import {BoardUI} from './board/components/Board.js';
import {ContextBar} from './board/components/ContextBar.js';
import {HelpUI} from './board/components/Help.js';
import {Workspace} from './board/model/context.model.js';
import {Mode} from './navigation/model/action-map.model.js';
import {appState} from './navigation/state/state.js';

export default function App({workspace}: {workspace: Workspace}) {
	const width = process.stdout.columns || 120;
	return (
		<Box flexDirection="column">
			{/* <Logo></Logo> */}
			{!(appState.mode === Mode.HELP) &&
				workspace.children.map((board, i) => <BoardUI board={board} key={i} />)}
			{appState.mode === Mode.HELP && <HelpUI width={width} />}
			<ContextBar width={width} />
		</Box>
	);
}
