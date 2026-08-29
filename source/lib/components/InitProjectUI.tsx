import chalk from 'chalk';
import {Box, Text} from 'ink';
import React from 'react';
import {
	listRecentProjects,
	RecentProject,
	recentProjectName,
} from '../config/recent-projects.js';
import {isFail} from '../model/result-types.js';
import {theme} from '../theme/themes.js';

type InitProjectUIProps = {
	width: number;
	height: number;
};

const MAX_LISTED = 8;

const getRecentProjects = (): RecentProject[] => {
	const result = listRecentProjects({exclude: process.cwd()});

	return isFail(result) ? [] : result.value.slice(0, MAX_LISTED);
};

export const InitProjectUI: React.FC<InitProjectUIProps> = ({
	width,
	height,
}) => {
	const recent = getRecentProjects();

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
				To start tracking issues here, we need to initialize a new
				<Text color={theme.primary} backgroundColor={theme.secondary}>
					{' .epiq/project.json '}
				</Text>
				file in this repository.
			</Text>

			<Box marginTop={1} flexDirection="column">
				<Box>
					<Text color={theme.accent}>{'   '}</Text>
					<Text color={theme.primary}>Type </Text>
					<Text backgroundColor={theme.secondary}>{' :init '}</Text>
				</Box>
			</Box>

			<Box marginTop={1}>
				<Text color={theme.secondary2}>This will create, commit and push </Text>
				<Text color={theme.primary} backgroundColor={theme.secondary}>
					{' .epiq/project.json '}
				</Text>
			</Box>

			{recent.length > 0 && (
				<Box marginTop={1} flexDirection="column">
					<Text color={theme.accent} bold>
						Or open a recent project
					</Text>

					{recent.map((entry, index) => (
						<Box key={entry.projectId}>
							<Text color={theme.accent}>{`   ${index + 1}  `}</Text>
							<Text color={theme.primary}>{recentProjectName(entry.root)}</Text>
							<Text color={theme.secondary2}>{`  ${entry.root}`}</Text>
						</Box>
					))}

					<Box marginTop={1}>
						<Text color={theme.accent}>{'   '}</Text>
						<Text color={theme.primary}>Type </Text>
						<Text backgroundColor={theme.secondary}>{' :open 1 '}</Text>
						<Text color={theme.secondary2}> or </Text>
						<Text backgroundColor={theme.secondary}>{' :open <path> '}</Text>
					</Box>
				</Box>
			)}
		</Box>
	);
};
