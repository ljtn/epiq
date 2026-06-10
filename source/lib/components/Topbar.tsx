import chalk from 'chalk';
import {Box, Text} from 'ink';
import React from 'react';
import {Mode} from '../model/action-map.model.js';
import {Filter} from '../model/app-state.model.js';
import {getSettingsState} from '../state/settings.state.js';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {Breadcrumb} from './BreadCrumb.js';
import {FilterUI} from './Filters.js';
import {PeekStatus} from './PeekStatus.js';
import {SyncStatusPill} from './SyncStatus.js';
import {VersionPill} from './VersionPill.js';

type Props = {
	filters: Filter[];
	hideBreadCrumb?: boolean;
};

export function Topbar({filters, hideBreadCrumb = false}: Props) {
	const {timeMode, syncStatus, mode} = useAppState();
	const {userName, preferredEditor, autoSync} = getSettingsState();
	const topRightWidth = 64;
	const breadCrumbWidth = process.stdout.columns - topRightWidth - 8;

	return (
		<Box
			justifyContent="space-between"
			flexDirection="row"
			max-width={process.stdout.columns - 40}
			overflow="hidden"
		>
			{hideBreadCrumb ? (
				<Text> </Text>
			) : mode === Mode.PALETTE ? (
				<Box>
					<Text color={theme.accent}>Command Palette</Text>
					<Text dimColor color={theme.secondary2}>
						{' '}
						- search, select and press enter
					</Text>
				</Box>
			) : (
				<Box paddingLeft={1}>
					{filters.length > 0 ? (
						<FilterUI filters={filters} />
					) : (
						<Breadcrumb width={breadCrumbWidth} />
					)}
				</Box>
			)}

			{timeMode === 'live' ? (
				<Box
					columnGap={1}
					paddingRight={2}
					max-width={topRightWidth}
					overflow="hidden"
					justifyContent="flex-end"
				>
					<SyncStatusPill
						autoSync={Boolean(autoSync)}
						syncStatus={syncStatus}
					/>
					<Text>
						{chalk.hex(theme.secondary2).dim('Mode: ') +
							chalk.hex(theme.secondary2).dim(mode.padEnd(8, ' '))}{' '}
					</Text>
					<HeaderPill icon="@" value={userName} />
					<HeaderPill icon="❯" value={preferredEditor} />
					<VersionPill />
				</Box>
			) : (
				''
			)}

			{timeMode === 'peek' ? <PeekStatus></PeekStatus> : ''}
		</Box>
	);
}

type HeaderPillProps = {
	icon: string;
	value: string | null;
};

function HeaderPill({icon, value}: HeaderPillProps) {
	return (
		<Text>
			{chalk.dim(icon) + chalk.hex(theme.accent)(` ${value ?? '-'} `)}
		</Text>
	);
}
