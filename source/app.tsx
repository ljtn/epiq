import chalk from 'chalk';
import {Box, Text} from 'ink';
import React from 'react';
import {hasPendingDefaultEvents} from './event/event-boot.js';
import {isSuccess} from './lib/model/result-types.js';
import {ContextBar} from './lib/components/ContextBar.js';
import {HelpUI} from './lib/components/Help.js';
import {Topbar} from './lib/components/Topbar.js';
import {WorkspaceUI} from './lib/components/WorkspaceUI.js';
import {getUserSetupStatus} from './lib/config/setup-utils.js';
import {Mode} from './lib/model/action-map.model.js';
import {findInBreadCrumb} from './lib/model/app-state.model.js';
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
				Initialize project
			</Text>

			<Text>{`This folder is not an ${chalk.hex(theme.accent)(
				'epiq',
			)} project yet.`}</Text>

			<Text color={theme.primary}>
				To start tracking issues here, we need to initialize a new{' '}
				<Text color={theme.primary} backgroundColor={theme.secondary}>
					{' ' + '.epiq/' + ' '}
				</Text>{' '}
				directory in this repository.
			</Text>

			<Box marginTop={1} flexDirection="column">
				<Box>
					<Text color={theme.accent}>{'   '}</Text>
					<Text color={theme.primary}>Type </Text>
					<Text backgroundColor={theme.secondary}>{' :init '}</Text>
				</Box>
			</Box>

			<Box marginTop={1}>
				<Text color={theme.secondary2}>
					(This will create the local epiq project files)
				</Text>
			</Box>
		</Box>
	);
};

export default function App({width, height}: AppProps) {
	const state = useAppState();
	const filters = state.filters;

	if (state.mode === Mode.HELP) {
		return (
			<Box flexDirection="column">
				<HelpUI width={width} />
			</Box>
		);
	}

	const {isSetup, hasPreferredEditor, hasUserName, userName, preferredEditor} =
		getUserSetupStatus();

	const isSetupMode = !isSetup;
	const isUninitializedRepo = isSetup && hasPendingDefaultEvents();

	if (isSetupMode) {
		return (
			<Box flexDirection="column">
				<Box flexDirection="column">
					<Topbar hideBreadCrumb filters={filters} />
					<SettingsUI
						height={height}
						width={width}
						hasUserName={hasUserName}
						hasPreferredEditor={hasPreferredEditor}
						userName={userName ?? ''}
						preferredEditor={preferredEditor ?? ''}
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
					<Topbar hideBreadCrumb filters={filters} />
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
			<Box flexDirection="column">
				<Topbar filters={filters} />
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

			<ContextBar
				width={width}
				mode={state.mode}
				availableHints={state.availableHints}
			/>
		</Box>
	);
}
