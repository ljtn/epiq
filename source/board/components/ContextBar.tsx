import {Box, Text} from 'ink';
import {navigationState} from '../../navigation/state/state.js';
import React from 'react';
import {Mode} from '../../navigation/model/action-map.model.js';

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
			<Text color={navigationState.mode === Mode.MOVE ? 'yellow' : 'gray'}>
				{navigationState.mode === Mode.MOVE
					? 'Use ARROW KEYS to move the item. Press M to exit move mode.'
					: 'Press H for help'}
			</Text>
		</Box>
	</Box>
);
