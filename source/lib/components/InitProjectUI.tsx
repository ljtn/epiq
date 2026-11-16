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
import {useSetupSession} from '../state/setup-session.state.js';
import {isInsideGitRepository} from '../storage/paths.js';
import {useAppState} from '../state/state.js';
import {useCmdState} from '../state/cmd.state.js';
import {Mode} from '../model/action-map.model.js';

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
	const {justCompleted} = useSetupSession();
	const inGitRepository = isInsideGitRepository(process.cwd());
	const {mode} = useAppState();
	const {value: line} = useCmdState();
	// Just set up, in a repository, with the handover's `init` still in the line.
	const asking =
		justCompleted &&
		inGitRepository &&
		mode === Mode.COMMAND_LINE &&
		line.trim() === 'init';

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
			{justCompleted && (
				<Text color={theme.accent} bold>
					Setup complete! 🔹
				</Text>
			)}

			{/* The handover asks; every other way here just says what to type. */}
			{!asking && (
				<Text color={theme.accent} bold>
					Initialize project
				</Text>
			)}

			<Text>{`This folder is not an ${chalk.hex(theme.accent)(
				'epiq',
			)} project yet.`}</Text>

			{!inGitRepository ? (
				<Text color={theme.primary}>
					It is not a git repository either. Run{' '}
					<Text color={theme.accent}>epiq</Text> inside one to start a project
					there.
				</Text>
			) : (
				<>
					{asking && (
						<Text color={theme.primary}>Do you want to start one here?</Text>
					)}

					<Box flexDirection="column">
						<Box>
							<Text color={theme.accent}>{'   '}</Text>
							{asking ? (
								<>
									<Text color={theme.primary}>Press </Text>
									<Text backgroundColor={theme.secondary}>{' enter '}</Text>
									<Text color={theme.primary}> to run </Text>
									<Text backgroundColor={theme.secondary}>{' :init '}</Text>
									<Text color={theme.secondary2}>, or </Text>
									<Text backgroundColor={theme.secondary}>{' esc '}</Text>
									<Text color={theme.secondary2}> to skip</Text>
								</>
							) : (
								<>
									<Text color={theme.primary}>Type </Text>
									<Text backgroundColor={theme.secondary}>{' :init '}</Text>
								</>
							)}
						</Box>
					</Box>

					<Box>
						<Text color={theme.secondary2}>
							This will create, commit and push{' '}
						</Text>
						<Text color={theme.primary} backgroundColor={theme.secondary}>
							{' .epiq/project.json '}
						</Text>
					</Box>
				</>
			)}

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
