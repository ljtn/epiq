import {Box, Text} from 'ink';
import {navigationState} from '../lib/state.js';
import React from 'react';

export const HelpUI: React.FC<{width: number}> = ({width}) => (
	<Box
		flexDirection="column"
		paddingLeft={1}
		paddingRight={1}
		paddingBottom={1}
		borderColor="gray"
		borderStyle="round"
		width={width}
	>
		<Box paddingBottom={1}>
			<Text color="gray">Actions:</Text>
		</Box>
		{navigationState.viewHelp
			? navigationState.availableActions
					.filter(action => Boolean(action.description))
					.filter(action => !/\[(↑|↓|←|→)]/.test(action.description as string)) // Remove arrow
					.map((action, index) => {
						const [leftRaw, rightRaw] = action.description!.split(']');
						const left = leftRaw?.trim() + ']'; // add bracket back
						const right = rightRaw?.trim(); // no extra space

						return (
							<Box key={index} flexDirection="row">
								<Box width={15}>
									<Text color="gray">{left}</Text>
								</Box>
								<Box flexGrow={1}>
									<Text color="gray">{right}</Text>
								</Box>
							</Box>
						);
					})
			: ''}
	</Box>
);
