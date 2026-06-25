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
import {ReplayStatus} from './ReplayStatus.js';
import {SyncStatusPill} from './SyncStatus.js';
import {VersionPill} from './VersionPill.js';
import {truncateWithEllipsis} from '../utils/string.utils.js';

type Props = {
	filters: Filter[];
	hideBreadCrumb?: boolean;
};

export function Topbar({filters, hideBreadCrumb = false}: Props) {
	const {timeMode, syncStatus, mode, replay} = useAppState();
	const {userName, preferredEditor, autoSync} = getSettingsState();
	const topRightWidth = 64;
	const breadCrumbWidth = process.stdout.columns - topRightWidth - 8;

	// During a replay the breadcrumb is just visual noise; drop it so the topbar
	// reads as a calm cinema marquee with only the REPLAY status on the right.
	const breadCrumbHidden = hideBreadCrumb || timeMode === 'replay';

	// While replaying, the left side narrates the event currently being applied,
	// mirroring the ticket history phrasing and ellipsised to the available room.
	const replayCaption = replay
		? truncateWithEllipsis(replay.currentLabel, Math.max(0, breadCrumbWidth))
		: '';

	return (
		<Box
			justifyContent="space-between"
			flexDirection="row"
			max-width={process.stdout.columns - 40}
			overflow="hidden"
		>
			{timeMode === 'replay' ? (
				<Box paddingLeft={1}>
					<Text color={theme.secondary2}>{replayCaption}</Text>
				</Box>
			) : breadCrumbHidden ? (
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

			{timeMode === 'replay' ? <ReplayStatus></ReplayStatus> : ''}
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
