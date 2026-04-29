import {Box, Text} from 'ink';
import React from 'react';
import {theme} from './lib/theme/themes.js';

type Props = {
	width: number;
	height: number;
	hasUserName: boolean;
	hasPreferredEditor: boolean;
	userName: string;
	preferredEditor: string;
};

type StepRowProps = {
	isDone: boolean;
	command: string;
	value?: string;
};

const StepRow: React.FC<StepRowProps> = ({isDone, command, value}) => {
	return (
		<Box>
			<Text color={theme.accent} dimColor={isDone}>
				{isDone ? ' ✔ ' : '   '}
			</Text>
			<Text dimColor={isDone}>Type </Text>
			<Text backgroundColor={theme.secondary} dimColor={isDone}>
				{' ' + command + ' '}
			</Text>
			{value && (
				<>
					<Text dimColor={isDone}> </Text>
					<Text color={theme.secondary} dimColor={isDone}>
						{'<' + value + '>'}
					</Text>
				</>
			)}
		</Box>
	);
};
export default function SettingsUI({
	width,
	height,
	hasUserName,
	hasPreferredEditor,
	userName,
	preferredEditor,
}: Props) {
	const isComplete = hasUserName && hasPreferredEditor;
	const activeCommand = !hasUserName
		? ':config:username'
		: !hasPreferredEditor
		? ':config:editor'
		: null;

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
				Welcome! 🔹
			</Text>

			<Text>Lets get you started - its a breeze.</Text>
			<Text color={theme.secondary2}>
				And remember, you can always get help with{' '}
				<Text color={theme.accent}>:help</Text>.
			</Text>

			{!isComplete && (
				<Text color={theme.secondary2}>
					{activeCommand === ':config:username'
						? 'First, choose your username.'
						: 'Nice. One more step.'}
				</Text>
			)}

			<Box flexDirection="column">
				{hasUserName && (
					<Box marginBottom={1}>
						<StepRow isDone command=":config:username" value={userName} />
					</Box>
				)}

				{!hasUserName && <StepRow isDone={false} command=":config:username" />}

				{hasUserName && !hasPreferredEditor && (
					<StepRow isDone={false} command=":config:editor" />
				)}

				{isComplete && (
					<Box>
						<StepRow isDone command=":config:editor" value={preferredEditor} />
					</Box>
				)}
			</Box>
		</Box>
	);
}
