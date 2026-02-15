import {Box, Text} from 'ink';
import React from 'react';
import {Mode} from '../navigation/model/action-map.model.js';
import {appState} from '../navigation/state/state.js';
import {CommandLine} from './CommandLine.js';
import {theme} from '../theme/themes.js';

export const ContextBar: React.FC<{width: number}> = ({width}) => {
	const {mode, availableHints} = appState;
	const hasHints = availableHints.length > 0;

	return (
		<Box
			flexDirection="column"
			paddingX={1}
			borderColor={theme.secondary}
			borderStyle="round"
			width={width}
		>
			<Box>
				{mode === Mode.COMMAND_LINE ? (
					<CommandLine />
				) : (
					<Box flexDirection="row" gap={2}>
						<Text>{hasHints ? '💡' : ' '}</Text>

						{availableHints.map((hint, index) => {
							const [command, ...rest] = hint.split(' ');
							const argument = rest.join(' ');

							return (
								<Box key={index}>
									<Text color={theme.accent}>{command}</Text>
									{argument && <Text color={theme.secondary}> {argument}</Text>}
								</Box>
							);
						})}
					</Box>
				)}
			</Box>
		</Box>
	);
};
