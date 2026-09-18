import {Box, Text} from 'ink';
import React from 'react';
import {theme} from '../theme/themes.js';
import {getUserSetupStatus} from '../config/setup-utils.js';
import {EmailCandidates} from './EmailCandidates.js';

type Props = {
	width: number;
	height: number;
};

type StepRowProps = {
	isDone: boolean;
	command: string;
	value?: string;
	/**
	 * How to reach this step, when it is the one being asked for. The first step
	 * is typed; every one after it is already in the command line, so telling
	 * somebody to type it again would be telling them to type over it.
	 */
	verb?: string;
	hint?: React.ReactNode;
};

const StepRow: React.FC<StepRowProps> = ({
	isDone,
	command,
	value,
	verb = 'Type',
	hint,
}) => {
	return (
		<Box>
			<Text color={theme.accent} dimColor={isDone}>
				{isDone ? ' ✔ ' : '   '}
			</Text>
			<Text dimColor={isDone}>{verb} </Text>
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
			{hint}
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
		isSetEmails,
		emailSetup,
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
		{
			key: 'emails',
			done: isSetEmails,
			command: ':config emails',
			value: emailSetup ?? undefined,
			// Last, because it is the only step that needs the board: it offers the
			// addresses this repository's own history contains.
			message:
				'Last one. Claim the git addresses whose commits are yours, so the board calls them by your name.',
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
			{/* Beside the `?` hint, because setup is where somebody meets the
			    command line for the first time and every step here suggests
			    something — an editor, an address, their own git name. */}
			<Text color={theme.secondary2}>
				Press
				<Text color={theme.accent}> tab </Text>
				to take a suggestion.
			</Text>

			{activeStep && <Text color={theme.secondary2}>{activeStep.message}</Text>}

			<Box flexDirection="column">
				{steps.map((step, index) => {
					const shouldShow = activeStepIndex === -1 || index <= activeStepIndex;

					if (!shouldShow) return null;

					const isActive = index === activeStepIndex;

					// The first step is the only one typed from scratch, so it is where
					// the shortcut is worth showing. Every later one is already in the
					// command line, waiting for its value.
					const isFirstAsk = isActive && activeStepIndex === 0;

					return (
						<Box key={step.key} flexDirection="column" marginBottom={1}>
							<StepRow
								isDone={step.done}
								command={isFirstAsk ? ':config us' : step.command}
								value={step.done ? formatValue(step.value) : undefined}
								verb={isActive && !isFirstAsk ? 'Waiting:' : 'Type'}
								hint={
									isFirstAsk ? (
										<Text color={theme.secondary2}>
											{' then '}
											<Text color={theme.accent}>tab</Text>
											{' to finish it'}
										</Text>
									) : isActive ? (
										<Text color={theme.secondary2}>
											{' — already typed, just answer it'}
										</Text>
									) : undefined
								}
							/>
							{/* The one step that asks about something in the repository
							    rather than about a preference, so it has to show what it
							    found before the numbers in its command mean anything. */}
							{step.key === 'emails' && !step.done && <EmailCandidates />}
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}
