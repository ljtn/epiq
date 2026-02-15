import {Box, Text} from 'ink';
import React, {useEffect, useState} from 'react';
import {
	getCommandLineInput,
	subscribeCommandLineState,
} from '../navigation/state/command-line.state.js';

const roleColors: Record<'command' | 'argument', string> = {
	command: 'cyan',
	argument: 'white',
};

export const CommandLine: React.FC = () => {
	const [input, setInput] = useState(getCommandLineInput());

	useEffect(() => {
		const unsubscribe = subscribeCommandLineState(() => {
			setInput(getCommandLineInput());
		});
		return () => {
			unsubscribe();
		};
	}, []);

	const [command, ...rest] = input.split(' ');
	const argument = rest.join(' ');

	return (
		<Box>
			<Text>:</Text>
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
