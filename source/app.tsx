import {Box} from 'ink';
import React from 'react';
import {WorkspaceUI} from './lib/components/WorkspaceUI.js';
import {ContextBar} from './lib/components/ContextBar.js';
import {HelpUI} from './lib/components/Help.js';
import {Mode} from './lib/model/action-map.model.js';
import {useAppState} from './lib/state/state.js';

export default function App() {
	const state = useAppState();
	const width = process.stdout.columns || 120;

	return (
		<Box flexDirection="column">
			{state.mode !== Mode.HELP && (
				<WorkspaceUI
					currentNode={state.currentNode}
					selectedIndex={state.selectedIndex}
					breadCrumb={state.breadCrumb}
					viewMode={state.viewMode}
					mode={state.mode}
				/>
			)}

			{state.mode === Mode.HELP && <HelpUI width={width} />}

			{state.mode !== Mode.HELP && (
				<ContextBar
					width={width}
					mode={state.mode}
					availableHints={state.availableHints}
				/>
			)}
		</Box>
	);
}
