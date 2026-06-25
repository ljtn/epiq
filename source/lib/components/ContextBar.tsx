import {Box} from 'ink';
import React from 'react';
import {Mode, ModeUnion} from '../model/action-map.model.js';
import {AppState} from '../model/app-state.model.js';
import {useAppState} from '../state/state.js';
import {CommandLine} from './CommandLine.js';
import {ContextBarInfo} from './ContextBarInfo.js';
import {ReplayProgressBar} from './ReplayProgressBar.js';

interface Props {
	width: number;
	mode: ModeUnion;
	availableHints: AppState['availableHints'];
}

export const ContextBar: React.FC<Props> = ({width, mode, availableHints}) => {
	const {timeMode} = useAppState();
	const isCommandInput = mode === Mode.COMMAND_LINE || mode === Mode.PALETTE;

	return (
		<Box>
			{isCommandInput ? (
				// The live command line always wins: this keeps `:peek now` (and any
				// other input) reachable even mid-replay, where it would otherwise be
				// hidden behind the scrubber.
				<CommandLine width={width} mode={mode} />
			) : timeMode === 'replay' ? (
				<ReplayProgressBar width={width} />
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
