import chalk from 'chalk';
import {Box, Text} from 'ink';
import React from 'react';
import {formatDateTime, safeDateFromUlid} from '../../event/date-utils.js';
import {isSuccess} from '../model/result-types.js';
import {Filter} from '../model/app-state.model.js';
import {getSettingsState} from '../state/settings.state.js';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {Breadcrumb} from './BreadCrumb.js';
import {FilterUI} from './Filters.js';

type Props = {
	filters: Filter[];
	hideBreadCrumb?: boolean;
};

export function Topbar({filters, hideBreadCrumb = false}: Props) {
	const {timeMode, eventLog, unappliedEvents} = useAppState();
	const {userName, preferredEditor} = getSettingsState();
	const topRightWidth = 40;
	const breadCrumbWidth = process.stdout.columns - topRightWidth - 8;

	const currentEventId = eventLog.at(-1)?.id;
	const currentEventTimeStampResult = safeDateFromUlid(currentEventId ?? '');
	const currentEventTimeStamp = isSuccess(currentEventTimeStampResult)
		? formatDateTime(currentEventTimeStampResult.data)
		: 'INVALID DATE';

	return (
		<Box
			justifyContent="space-between"
			flexDirection="row"
			max-width={process.stdout.columns - 40}
			overflow="hidden"
		>
			{hideBreadCrumb ? (
				<Text> </Text>
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
					<HeaderPill icon="@" value={userName} />
					<HeaderPill icon="❯" value={preferredEditor} />
				</Box>
			) : (
				''
			)}

			{timeMode === 'peek' ? (
				<Box paddingLeft={1}>
					<Text backgroundColor={theme.yellow}> Readonly </Text>
					<Text color={theme.yellow}>
						{' ' + unappliedEvents.length + ' edits ago at '}
					</Text>
					<Text backgroundColor={theme.yellow} color={theme.accent}>
						{' ' + currentEventTimeStamp + ' '}
					</Text>
					<Text color={theme.yellow}>. Resume with </Text>
					<Text backgroundColor={theme.yellow}> :peek now </Text>
				</Box>
			) : (
				''
			)}
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
