import {Box, Text} from 'ink';
import React from 'react';
import {navigationState} from '../../navigation/state/state.js';

export const CommandLine: React.FC = () => (
	<Box>
		<Text color={'gray'}>:</Text>
		<Text>{navigationState.commandLineInput}</Text>
	</Box>
);
