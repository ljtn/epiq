import React from 'react';
import {Box, Text} from 'ink';
import {board} from './mock/board.js';
import {BoardUI} from './components/board.js';

type Props = {
	name?: string;
};

export default function App({name = 'Funny guy'}: Props) {
	return (
		<Box flexDirection="column">
			{/* Optional Greeting */}
			<Box marginBottom={1}>
				<Box marginLeft={1}>
					<Text>
						Hello, <Text color="green">{name}</Text>
					</Text>
				</Box>
			</Box>

			{/* The Swimlane UI */}
			<BoardUI board={board} />
		</Box>
	);
}
