import {Box, Text} from 'ink';
import React from 'react';
import {getCommandLineInput} from '../../navigation/state/command-line.state.js';

export const CommandLine: React.FC = () => (
	<Box>
		<Text color={'gray'}>:</Text>
		<Text>{getCommandLineInput()}</Text>
	</Box>
);
