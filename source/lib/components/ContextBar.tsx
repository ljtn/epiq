import {Box, Text} from 'ink';
import React from 'react';
import {Mode, ModeUnion} from '../model/action-map.model.js';
import {AppState} from '../model/app-state.model.js';
import {theme} from '../theme/themes.js';
import {CommandLine} from './CommandLine.js';

interface Props {
	width: number;
	mode: ModeUnion;
	availableHints: AppState['availableHints'];
}

export const ContextBar: React.FC<Props> = ({width, mode, availableHints}) => {
	const clampedHints: string[] = [];
	let usedWidth = 0;

	for (const hint of availableHints) {
		const separator = clampedHints.length > 0 ? ' | ' : '';
		const nextWidth = separator.length + hint.length;

		if (usedWidth + nextWidth > width + 2) break;

		clampedHints.push(hint);
		usedWidth += nextWidth;
	}

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
					<Box flexDirection="row">
						{clampedHints.map((hint, index) => (
							<Text key={hint} color={theme.secondary}>
								{(index > 0 ? ' | ' : '') + hint}
							</Text>
						))}
						<Text> </Text>
					</Box>
				</Box>
			)}
		</Box>
	);
};
