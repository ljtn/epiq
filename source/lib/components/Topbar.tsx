import chalk from 'chalk';
import {Box, Text} from 'ink';
import React from 'react';
import {Filter} from '../model/app-state.model.js';
import {getSettingsState} from '../state/settings.state.js';
import {Breadcrumb} from './BreadCrumb.js';
import {FilterUI} from './Filters.js';
import {theme} from '../theme/themes.js';

type Props = {
	filters: Filter[];
	hideBreadCrumb?: boolean;
};

export function HeaderBar({filters, hideBreadCrumb = false}: Props) {
	const {userName, preferredEditor} = getSettingsState();

	return (
		<Box justifyContent="space-between" flexDirection="row">
			{hideBreadCrumb ? (
				<Text> </Text>
			) : (
				<Box paddingLeft={1}>
					{filters.length > 0 ? <FilterUI filters={filters} /> : <Breadcrumb />}
				</Box>
			)}

			<Box columnGap={1} paddingRight={2}>
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
