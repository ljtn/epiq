import {Box, Text} from 'ink';
import {appState} from '../state/state.js';
import React from 'react';
import {Mode} from '../model/action-map.model.js';
import {theme} from '../theme/themes.js';

export const HelpUI: React.FC<{width: number}> = ({width}) => (
	<Box
		flexDirection="column"
		marginTop={3}
		borderColor={theme.secondary}
		borderStyle="round"
		width={width}
		minHeight={19}
	>
		<Box flexDirection="column" width={width}>
			{appState.mode === Mode.HELP
				? [
						{
							action: '',
							description: '[COMMAND] DESCRIPTION',
							mode: appState.mode,
						},
						...appState.availableActions,
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
											<Text color={index ? theme.primary : theme.secondary}>
												{right}
											</Text>
										</Box>
										<Box width={20}>
											<Text color={index ? theme.accent : theme.secondary}>
												{left}
											</Text>
										</Box>
									</Box>
								</Box>
							);
						})
				: null}
		</Box>
	</Box>
);
