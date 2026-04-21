import {Box} from 'ink';
import React from 'react';
import {Mode, ModeUnion} from '../model/action-map.model.js';
import {AppState} from '../model/app-state.model.js';
import {useAppState} from '../state/state.js';
import {CommandLine} from './CommandLine.js';
import {ContextBarInfo} from './ContextBarInfo.js';

interface Props {
	width: number;
	mode: ModeUnion;
	availableHints: AppState['availableHints'];
}

export const ContextBar: React.FC<Props> = ({width, mode, availableHints}) => {
	const state = useAppState();
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
			{mode === Mode.COMMAND_LINE && state.syncStatus.status !== 'syncing' ? (
				<CommandLine width={width} />
			) : (
				<ContextBarInfo
					width={width}
					mode={mode}
					availableHints={availableHints}
				></ContextBarInfo>
			)}
		</Box>
	);
};
