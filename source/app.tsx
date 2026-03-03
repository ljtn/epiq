import {Box} from 'ink';
import React from 'react';
import {WorkspaceUI} from './lib/components/WorkspaceUI.js';
import {ContextBar} from './lib/components/ContextBar.js';
import {HelpUI} from './lib/components/Help.js';
import {Workspace} from './lib/model/context.model.js';
import {Mode} from './lib/model/action-map.model.js';
import {useAppState} from './lib/state/state.js';

export default function App({workspace}: {workspace: Workspace}) {
	const {mode} = useAppState();
	const width = process.stdout.columns || 120;

	return (
		<Box flexDirection="column">
			{mode !== Mode.HELP && <WorkspaceUI workspace={workspace} />}
			{mode === Mode.HELP && <HelpUI width={width} />}
			{mode !== Mode.HELP && <ContextBar width={width} />}
		</Box>
	);
}
