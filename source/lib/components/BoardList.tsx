import {Box, Text} from 'ink';
import React from 'react';
import {getOrderedChildren} from '../repository/rank.js';
import {getRenderedChildren, useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {CursorUI} from './Cursor.js';

export default function BoardList() {
	const state = useAppState();
	const workspace = state.nodes[state.rootNodeId];
	const breadCrumbHeight = 1;
	const commandLineHeight = 3;
	const height = process.stdout.rows - breadCrumbHeight - commandLineHeight;
	const width = process.stdout.columns || 120;
	const children = workspace?.id ? getRenderedChildren(workspace?.id) : [];

	return (
		<Box
			flexDirection="column"
			height={height}
			padding={1}
			borderStyle="round"
			borderColor={theme.secondary}
			width={width}
		>
			<Box padding={1} paddingTop={0} paddingBottom={0}>
				<Text>Select a board:</Text>
			</Box>

			<Box padding={1} flexDirection="column">
				{children.map((board, i) => {
					const isSelected =
						state.currentNode.context === 'WORKSPACE' &&
						state.selectedIndex === i;

					const swimlanes = getRenderedChildren(board.id);
					const issuesCount = swimlanes.flatMap(({id}) =>
						getOrderedChildren(id),
					).length;

					return (
						<Box key={board.id ?? i}>
							<Text color={isSelected ? theme.accent : theme.secondary2}>
								<CursorUI isSelected={isSelected}></CursorUI>
							</Text>
							<Text color={isSelected ? theme.accent : theme.secondary2}>
								{board.title} ({issuesCount} issues)
								{board.readonly ? ' 🔒' : ''}
							</Text>
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}
