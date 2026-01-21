import React from 'react';
import {Box, Text} from 'ink';
import {getCommandLineInput} from '../../navigation/state/command-line.state.js';

const roleColors: Record<'command' | 'argument', string> = {
	command: 'cyan',
	argument: 'white',
};

export const CommandLine: React.FC = () => {
	const input = getCommandLineInput();

	// Split only on the FIRST space
	const [command, ...rest] = input.split(' ');
	const argument = rest.join(' ');

	return (
		<Box>
			<Text color="gray">:</Text>
			{command && <Text color={roleColors.command}>{command}</Text>}
			{argument && (
				<Text>
					{' '}
					<Text color={roleColors.argument}>{"'" + argument + "'"}</Text>
				</Text>
			)}
		</Box>
	);
};
