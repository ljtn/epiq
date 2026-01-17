import {Box, Text} from 'ink';
import {navigationState} from '../../navigation/state/state.js';
import React from 'react';
import {Mode} from '../../navigation/model/action-map.model.js';

export const HelpUI: React.FC<{width: number}> = ({width}) => (
	<Box
		flexDirection="column"
		marginTop={3}
		borderColor="gray"
		borderStyle="round"
		width={width}
		minHeight={19}
	>
		<Box flexDirection="column" width={width}>
			{navigationState.mode === Mode.HELP
				? [
						{
							action: '',
							description: '[COMMAND] DESCRIPTION',
							mode: navigationState.mode,
						},
						...navigationState.availableActions,
				  ]
						.filter(action => Boolean(action.description))
						// .filter(x => x.mode === navigationState.mode)
						.map((action, index) => {
							const [leftRaw, rightRaw] = action.description!.split(']');
							const left = leftRaw?.replace('[', '');
							const right = rightRaw?.trim(); // no extra space

							return (
								<Box paddingLeft={1} key={index} flexDirection="row">
									<Box
										key={index}
										flexDirection="row"
										paddingBottom={index ? 0 : 1}
									>
										<Box flexGrow={1} width={30}>
											<Text color={index ? 'white' : 'gray'}>{right}</Text>
										</Box>
										<Box width={20}>
											<Text color={index ? 'yellow' : 'gray'}>{left}</Text>
										</Box>
									</Box>
								</Box>
							);
						})
				: null}
		</Box>
	</Box>
);
