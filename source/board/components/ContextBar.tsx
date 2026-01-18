import {Box, Text} from 'ink';
import React from 'react';
import {Mode} from '../../navigation/model/action-map.model.js';
import {navigationState} from '../../navigation/state/state.js';
import {CommandLine} from './CommandLine.js';

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
			{navigationState.mode === Mode.COMMAND_LINE ? (
				<Box>
					<CommandLine></CommandLine>
				</Box>
			) : (
				<Text color="yellow">
					{'💡 ' + navigationState.availableHints.join('  ')}
				</Text>
			)}
		</Box>
	</Box>
);
