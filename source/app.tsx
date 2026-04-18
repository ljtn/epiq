import {Box, Text} from 'ink';
import React from 'react';
import {
	hasPendingDefaultEvents,
	persistPendingDefaultEvents,
} from './event/event-boot.js';
import {isFail, isSuccess} from './lib/command-line/command-types.js';
import {ContextBar} from './lib/components/ContextBar.js';
import {HelpUI} from './lib/components/Help.js';
import {HeaderBar} from './lib/components/Topbar.js';
import {WorkspaceUI} from './lib/components/WorkspaceUI.js';
import {Mode} from './lib/model/action-map.model.js';
import {findInBreadCrumb} from './lib/model/app-state.model.js';
import {getSettingsState} from './lib/state/settings.state.js';
import {getRenderedChildren, getState, useAppState} from './lib/state/state.js';
import SettingsUI from './SettingsUI.js';

type AppProps = {
	height: number;
	width: number;
};

export default function App({width, height}: AppProps) {
	const state = useAppState();
	const settings = getSettingsState();

	const hasUserName = Boolean(
		settings.userName?.trim() && settings.userName !== 'system',
	);
	const hasPreferredEditor = Boolean(settings.preferredEditor?.trim());
	const isConfigured = hasUserName && hasPreferredEditor;
	const filters = useAppState().filters;

	const isSetupMode =
		settings.userName === 'system' || !settings.preferredEditor;

	if (!isConfigured) {
		return (
			<Box flexDirection="column">
				<Box flexDirection="column">
					<HeaderBar hideBreadCrumb={isSetupMode} filters={filters} />
					<SettingsUI
						height={height}
						width={width}
						hasUserName={hasUserName}
						hasPreferredEditor={hasPreferredEditor}
						userName={settings.userName ?? ''}
						preferredEditor={settings.preferredEditor ?? ''}
					/>
				</Box>

				<ContextBar
					width={width}
					mode={state.mode}
					availableHints={state.availableHints}
				/>
			</Box>
		);
	}

	// Persist default events if they haven't been persisted yet, to ensure the same ids are used for materialization and persistence.
	if (hasPendingDefaultEvents()) {
		const persistResult = persistPendingDefaultEvents();
		if (isFail(persistResult)) {
			return <Text>{persistResult.message}</Text>;
		}
	}

	const board = findInBreadCrumb(getState().breadCrumb ?? [], 'BOARD');
	if (isSuccess(board)) {
		const boardId = board.data.id;
		const numberOfSwimlanes = getRenderedChildren(boardId).length;
		const swimlanePart = 3;
		const swimlaneMaxWidth = Math.floor(width / swimlanePart);
		const swimlaneDynamicWidth = Math.floor(
			width / Math.max(numberOfSwimlanes, 1),
		);
		const colWidth = Math.min(swimlaneDynamicWidth, swimlaneMaxWidth);
		width = colWidth * Math.max(numberOfSwimlanes, swimlanePart);
	}

	return (
		<Box flexDirection="column">
			{state.mode !== Mode.HELP && (
				<Box flexDirection="column">
					<HeaderBar filters={filters} />
					<WorkspaceUI
						width={width}
						height={height}
						currentNode={state.currentNode}
						selectedIndex={state.selectedIndex}
						breadCrumb={state.breadCrumb}
						viewMode={state.viewMode}
						mode={state.mode}
					/>
				</Box>
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
