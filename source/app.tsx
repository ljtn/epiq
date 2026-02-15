import {Box} from 'ink';
import React from 'react';
import {WorkspaceUI} from './lib/components/WorkspaceUI.js';
import {ContextBar} from './lib/components/ContextBar.js';
import {HelpUI} from './lib/components/Help.js';
import {Workspace} from './lib/model/context.model.js';
import {Mode} from './lib/navigation/model/action-map.model.js';
import {appState} from './lib/navigation/state/state.js';

export default function App({workspace}: {workspace: Workspace}) {
	const width = process.stdout.columns || 120;
	return (
		<Box flexDirection="column">
			{/* <Logo></Logo> */}
			{!(appState.mode === Mode.HELP) && <WorkspaceUI workspace={workspace} />}
			{appState.mode === Mode.HELP && <HelpUI width={width} />}
			<ContextBar width={width} />
		</Box>
	);
}
