import {Box, Text} from 'ink';
import React from 'react';
import {Mode, ModeUnion} from '../model/action-map.model.js';
import {theme} from '../theme/themes.js';
import {CommandLine} from './CommandLine.js';
import {AppState} from '../model/app-state.model.js';

interface Props {
	width: number;
	mode: ModeUnion;
	availableHints: AppState['availableHints'];
}

export const ContextBar: React.FC<Props> = ({width, mode, availableHints}) => {
	return (
		<Box>
			{mode === Mode.COMMAND_LINE ? (
				<CommandLine width={width} />
			) : (
				<Box
					flexDirection="column"
					paddingX={1}
					borderColor={theme.secondary}
					borderStyle="round"
					width={width}
				>
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
				</Box>
			)}
		</Box>
	);
};
