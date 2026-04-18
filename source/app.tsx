import {Box, Text} from 'ink';
import React from 'react';
import {hasPendingDefaultEvents} from './event/event-boot.js';
import {isSuccess} from './lib/command-line/command-types.js';
import {ContextBar} from './lib/components/ContextBar.js';
import {HelpUI} from './lib/components/Help.js';
import {HeaderBar} from './lib/components/Topbar.js';
import {WorkspaceUI} from './lib/components/WorkspaceUI.js';
import {Mode} from './lib/model/action-map.model.js';
import {findInBreadCrumb} from './lib/model/app-state.model.js';
import {getSettingsState} from './lib/state/settings.state.js';
import {getRenderedChildren, getState, useAppState} from './lib/state/state.js';
import {theme} from './lib/theme/themes.js';
import SettingsUI from './SettingsUI.js';

type AppProps = {
	height: number;
	width: number;
};

type InitProjectUIProps = {
	width: number;
	height: number;
};

const InitProjectUI: React.FC<InitProjectUIProps> = ({width, height}) => {
	return (
		<Box
			height={height - 4}
			flexDirection="column"
			width={width}
			paddingTop={1}
			paddingLeft={2}
			borderStyle="round"
			borderColor={theme.secondary}
			rowGap={1}
		>
			<Text color={theme.accent} bold>
				Initialize project 📦
			</Text>

			<Text dimColor>This folder does not contain an epiq project yet.</Text>

			<Text dimColor>
				To start tracking issues here, initialize a new{' '}
				<Text color={theme.secondary}>.epiq/</Text> directory in this
				repository.
			</Text>

			<Box marginTop={1} flexDirection="column">
				<Box>
					<Text color={theme.accent}>{'   '}</Text>
					<Text dimColor>Type </Text>
					<Text backgroundColor={theme.secondary}>{' :init '}</Text>
				</Box>
			</Box>

			<Box marginTop={1}>
				<Text dimColor>
					This will create the local epiq project files for this repo.
				</Text>
			</Box>
		</Box>
	);
};

export default function App({width, height}: AppProps) {
	const state = useAppState();
	const settings = getSettingsState();
	const filters = state.filters;

	const hasUserName = Boolean(settings.userName?.trim());
	const hasPreferredEditor = Boolean(settings.preferredEditor?.trim());
	const isConfigured = hasUserName && hasPreferredEditor;

	const isSetupMode = !isConfigured;
	const isUninitializedRepo = isConfigured && hasPendingDefaultEvents();

	if (isSetupMode) {
		return (
			<Box flexDirection="column">
				<Box flexDirection="column">
					<HeaderBar hideBreadCrumb filters={filters} />
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

	if (isUninitializedRepo) {
		return (
			<Box flexDirection="column">
				<Box flexDirection="column">
					<HeaderBar hideBreadCrumb filters={filters} />
					<InitProjectUI height={height} width={width} />
				</Box>

				<ContextBar
					width={width}
					mode={state.mode}
					availableHints={state.availableHints}
				/>
			</Box>
		);
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
