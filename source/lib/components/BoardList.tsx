import {Box, Text} from 'ink';
import React from 'react';
import {Workspace} from '../model/context.model.js';
import {getState} from '../state/state.js';
import {theme} from '../theme/themes.js';

export default function BoardList({workspace}: {workspace: Workspace}) {
	const breadCrumbHeight = 1;
	const commandLineHeight = 3;
	const height = process.stdout.rows - breadCrumbHeight - commandLineHeight;
	const width = process.stdout.columns || 120;
	return (
		<Box
			flexDirection="column"
			height={height}
			padding={1}
			borderStyle={'round'}
			borderColor={theme.secondary}
			width={width}
		>
			<Box padding={1} paddingTop={0} paddingBottom={0}>
				<Text>Select a board:</Text>
			</Box>
			<Box padding={1} flexDirection="column">
				{workspace.children.map((board, i) => (
					<Box key={i}>
						<Text
							color={
								getState().selectedIndex === i ? theme.accent : theme.secondary
							}
						>
							{getState().selectedIndex === i ? '⸬  ' : '   '}
						</Text>
						<Text
							color={
								getState().selectedIndex === i ? theme.accent : theme.secondary
							}
						>
							{board.name}{' '}
							{'(' +
								board.children.flatMap(x => x.children).length +
								' issues)'}
						</Text>
					</Box>
				))}
			</Box>
		</Box>
	);
}
