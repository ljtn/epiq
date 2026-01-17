import {Box, Text} from 'ink';
import React from 'react';
import {navigationState} from '../../navigation/state/state.js';

export const ContextBar: React.FC<{width: number}> = ({width}) => (
	<Box
		flexDirection="column"
		paddingLeft={1}
		paddingRight={1}
		borderColor="gray"
		borderStyle="round"
		width={width}
	>
		<Box>
			<Text color="gray">
				{'💡 ' + navigationState.availableHints.join(' 💡 ')}
			</Text>
		</Box>
	</Box>
);
