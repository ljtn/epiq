import {Box, Text} from 'ink';
import {navigationState} from '../lib/state.js';
import React from 'react';

export const HelpUI: React.FC<{width: number}> = ({width}) => (
	<Box
		flexDirection="column"
		paddingLeft={1}
		paddingRight={1}
		borderColor="gray"
		borderStyle="round"
		width={width}
	>
		<Box>
			<Text color="gray">Toggle help with "H"</Text>
		</Box>
		{navigationState.viewHelp
			? navigationState.availableActions
					.filter(action => Boolean(action.description))
					.filter(x => x.mode === navigationState.mode)
					.filter(action => !/\[(↑|↓|←|→)]/.test(action.description as string)) // Remove arrow
					.map((action, index) => {
						const [leftRaw, rightRaw] = action.description!.split(']');
						const left = leftRaw?.replace('[', '');
						const right = rightRaw?.trim(); // no extra space

						return (
							<Box paddingLeft={1} key={index} flexDirection="row">
								<Box width={20}>
									<Text color="gray">{'- ' + right}</Text>
								</Box>
								<Box flexGrow={1}>
									<Text color="gray">{left}</Text>
								</Box>
							</Box>
						);
					})
			: null}
	</Box>
);
