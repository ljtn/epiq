import {Box, Text} from 'ink';
import React from 'react';
import {theme} from '../theme/themes.js';
import {getUserSetupStatus} from '../config/setup-utils.js';

type Props = {
	width: number;
	height: number;
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
			{value !== undefined && (
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

const formatValue = (value: unknown) => {
	if (typeof value === 'string') return value;
	if (typeof value === 'boolean') return value ? 'on' : 'off';
	return undefined;
};

export default function SettingsUI({width, height}: Props) {
	const {
		isSetPreferredEditor,
		isSetUserName,
		userName,
		preferredEditor,
		autoSync,
		isSetAutoSync,
	} = getUserSetupStatus();
	const steps = [
		{
			key: 'username',
			done: isSetUserName,
			command: ':config username',
			value: userName,
			message: 'First, choose your username.',
		},
		{
			key: 'editor',
			done: isSetPreferredEditor,
			command: ':config editor',
			value: preferredEditor,
			message: 'Nice. Now pick your editor.',
		},
		{
			key: 'autosync',
			done: isSetAutoSync,
			command: ':config autosync',
			value: autoSync,
			message: 'Almost there. Configure auto sync.',
		},
	];

	const activeStepIndex = steps.findIndex(step => !step.done);
	const activeStep =
		activeStepIndex === -1 ? undefined : steps[activeStepIndex];
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

			<Text>Let's get you started - it's a breeze.</Text>
			<Text color={theme.secondary2}>
				Remember - you can always search available commands by typing:
				<Text color={theme.accent}> ? </Text>
			</Text>

			{activeStep && <Text color={theme.secondary2}>{activeStep.message}</Text>}

			<Box flexDirection="column">
				{steps.map((step, index) => {
					const shouldShow = activeStepIndex === -1 || index <= activeStepIndex;

					if (!shouldShow) return null;

					return (
						<Box key={step.key} marginBottom={1}>
							<StepRow
								isDone={step.done}
								command={step.command}
								value={step.done ? formatValue(step.value) : undefined}
							/>
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}
