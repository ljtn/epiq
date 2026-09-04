import {Box, Text} from 'ink';
import React from 'react';
import {ActionHint} from '../hints/hints.js';
import {ModeUnion} from '../model/action-map.model.js';
import {AppState} from '../model/app-state.model.js';
import {theme} from '../theme/themes.js';

interface Props {
	width: number;
	mode: ModeUnion;
	availableHints: AppState['availableHints'];
}

const SEPARATOR = '  ';

const hintWidth = ({keys, label}: ActionHint) => keys.length + 1 + label.length;

// As many shortcuts as fit on one row, in order; the rest are on the help
// screen.
const getClampedHints = (availableHints: ActionHint[], width: number) => {
	const clampedHints: ActionHint[] = [];
	let usedWidth = 0;

	for (const hint of availableHints) {
		const separator = clampedHints.length > 0 ? SEPARATOR.length : 0;
		const nextWidth = separator + hintWidth(hint);

		if (usedWidth + nextWidth > width - 4) break;

		clampedHints.push(hint);
		usedWidth += nextWidth;
	}

	return clampedHints;
};

export const ContextBarInfo: React.FC<Props> = ({width, availableHints}) => {
	const hints = getClampedHints(availableHints, width);
	const EMPTY_PLACEHOLDER = ' ';

	return (
		<Box
			width={width}
			borderStyle="round"
			borderColor={theme.secondary}
			paddingX={1}
		>
			{hints.length ? (
				<Text wrap="truncate">
					{hints.map(({keys, label}, index) => (
						<Text key={`${keys}-${label}`}>
							{index > 0 ? SEPARATOR : ''}
							<Text color={theme.accent}>{keys}</Text>
							<Text color={theme.secondary2}> {label}</Text>
						</Text>
					))}
				</Text>
			) : (
				<Text color={theme.secondary2}>{EMPTY_PLACEHOLDER}</Text>
			)}
		</Box>
	);
};
