import {Box, Text} from 'ink';
import React from 'react';
import {ModeUnion} from '../model/action-map.model.js';
import {AppState} from '../model/app-state.model.js';
import {theme} from '../theme/themes.js';

interface Props {
	width: number;
	mode: ModeUnion;
	availableHints: AppState['availableHints'];
}

const getClampedHints = (availableHints: string[], width: number) => {
	const clampedHints: string[] = [];
	let usedWidth = 0;

	for (const hint of availableHints) {
		const separator = clampedHints.length > 0 ? ' | ' : '';
		const nextWidth = separator.length + hint.length;

		if (usedWidth + nextWidth > width - 4) break;

		clampedHints.push(hint);
		usedWidth += nextWidth;
	}

	return clampedHints;
};

export const ContextBarInfo: React.FC<Props> = ({width, availableHints}) => {
	const hintLine = getClampedHints(availableHints, width).join(' | ');
	const EMPTY_PLACEHOLDER = '\u00A0';
	return (
		<Box
			width={width}
			borderStyle="round"
			borderColor={theme.secondary}
			paddingX={1}
		>
			<Text color={theme.secondary2}>
				{hintLine.length ? hintLine : EMPTY_PLACEHOLDER}
			</Text>
		</Box>
	);
};
