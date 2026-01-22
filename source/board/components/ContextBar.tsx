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
				<CommandLine />
			) : (
				<Box flexDirection="row" gap={2}>
					<Text>💡</Text>
					{navigationState.availableHints.map((x, index) => {
						const [command, ...rest] = x.split(' ');
						const argument = rest.join(' ');
						return (
							<Box key={index}>
								<Text color="cyan">{command}</Text>
								{argument && (
									<>
										<Text> </Text>
										<Text color="gray">{argument}</Text>
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
