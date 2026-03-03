import {Box, Text} from 'ink';
import React from 'react';
import {Mode} from '../model/action-map.model.js';
import {getState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {CommandLine} from './CommandLine.js';

export const ContextBar: React.FC<{width: number}> = ({width}) => {
	const {mode, availableHints} = getState();
	// const hasHints = availableHints.length > 0;

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
						{/* <Text color={theme.secondary}>{hasHints ? '💡 Hints:' : ' '}</Text> */}
						{availableHints.map((hint, index) => {
							return (
								<Box key={index}>
									<Text color={theme.secondary}>{hint}</Text>
								</Box>
							);
						})}
						<Text> </Text>
					</Box>
				)}
			</Box>
		</Box>
	);
};
