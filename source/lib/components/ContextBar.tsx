import {Box, Text} from 'ink';
import React from 'react';
import {Mode} from '../navigation/model/action-map.model.js';
import {appState} from '../navigation/state/state.js';
import {CommandLine} from './CommandLine.js';
import {theme} from '../theme/themes.js';

export const ContextBar: React.FC<{width: number}> = ({width}) => (
	<Box
		flexDirection="column"
		paddingLeft={1}
		paddingRight={1}
		borderColor={theme.secondary}
		borderStyle="round"
		width={width}
	>
		<Box>
			{appState.mode === Mode.COMMAND_LINE ? (
				<CommandLine />
			) : (
				<Box flexDirection="row" gap={2}>
					<Text>💡</Text>
					{appState.availableHints.map((x, index) => {
						const [command, ...rest] = x.split(' ');
						const argument = rest.join(' ');
						return (
							<Box key={index}>
								<Text color={theme.accent}>{command}</Text>
								{argument && (
									<>
										<Text> </Text>
										<Text color={theme.secondary}>{argument}</Text>
									</>
								)}
							</Box>
						);
					})}
				</Box>
			)}
		</Box>
	</Box>
);
