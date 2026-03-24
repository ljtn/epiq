import {Box, Text} from 'ink';
import React from 'react';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {filterMap} from '../utils/array.utils.js';

export default function BoardList() {
	const state = useAppState();
	const workspace = state.nodes[state.rootNodeId];

	const breadCrumbHeight = 1;
	const commandLineHeight = 3;
	const height = process.stdout.rows - breadCrumbHeight - commandLineHeight;
	const width = process.stdout.columns || 120;

	if (!workspace?.children) return;
	const children = filterMap(workspace.children, id => state.nodes[id]);

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

					const swimlanes = filterMap(board.children, id => state.nodes[id]);
					const issuesCount = swimlanes.flatMap(l => l.children ?? []).length;

					return (
						<Box key={board.id ?? i}>
							<Text color={isSelected ? theme.accent : theme.secondary}>
								{isSelected ? '⸬  ' : '   '}
							</Text>
							<Text color={isSelected ? theme.accent : theme.secondary}>
								{board.name} ({issuesCount} issues)
							</Text>
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}
