import {Box, Text} from 'ink';
import React from 'react';
import {appState} from '../../navigation/state/state.js';
import {Board} from '../model/context.model.js';
import {BoardContentUI} from './Swimlanes.js';

export const BoardUI: React.FC<{board: Board}> = ({board}) => {
	const width = process.stdout.columns || 120;
	const swimlaneMaxWidth = Math.floor(process.stdout.columns / 3);
	const swimlaneDynamicWidth = Math.floor(width / board.children.length);
	const renderedWidth = swimlaneDynamicWidth * board.children.length;
	const swimlaneWidth = Math.min(renderedWidth, swimlaneMaxWidth);

	const [_, ...rest] = appState.breadCrumb;
	return (
		<Box flexDirection="column">
			<Box paddingLeft={1}>
				<Text>{[...rest].map(b => '  >  ' + b.name)}</Text>
			</Box>

			<Box flexDirection="row">
				<BoardContentUI items={board.children} width={swimlaneWidth} />
			</Box>
		</Box>
	);
};
