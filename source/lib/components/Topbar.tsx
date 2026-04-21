import chalk from 'chalk';
import {Box, Text} from 'ink';
import React from 'react';
import {Filter} from '../model/app-state.model.js';
import {getSettingsState} from '../state/settings.state.js';
import {theme} from '../theme/themes.js';
import {Breadcrumb} from './BreadCrumb.js';
import {FilterUI} from './Filters.js';

type Props = {
	filters: Filter[];
	hideBreadCrumb?: boolean;
};

export function HeaderBar({filters, hideBreadCrumb = false}: Props) {
	const {userName, preferredEditor} = getSettingsState();
	const topRightWidth = 40;
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
			) : (
				<Box paddingLeft={1}>
					{filters.length > 0 ? (
						<FilterUI filters={filters} />
					) : (
						<Breadcrumb width={breadCrumbWidth} />
					)}
				</Box>
			)}

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
			{chalk.dim(icon) + chalk.hex(theme.accent2)(` ${value ?? '-'} `)}
		</Text>
	);
}
