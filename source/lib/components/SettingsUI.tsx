import {Box, Text} from 'ink';
import React from 'react';
import {theme} from '../theme/themes.js';
import {truncateToWidth} from '../utils/string.utils.js';
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
	/** How to reach the step: typed for the first, already in the line after. */
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

/** The claimed addresses, fitted to the step row's width. */
export const claimedAddresses = (
	emails: string[],
	width: number,
): string | undefined =>
	emails.length === 0
		? undefined
		: truncateToWidth(emails.join(', '), Math.max(12, width - 34));

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
		claimedEmails,
		emailSetupDeclined,
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
			// Cut to fit: addresses run long and would wrap out of the box.
			value: emailSetupDeclined
				? 'declined'
				: claimedAddresses(claimedEmails, width),
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

			{activeStep && <Text color={theme.secondary2}>{activeStep.message}</Text>}

			<Box flexDirection="column">
				{steps.map((step, index) => {
					const shouldShow = activeStepIndex === -1 || index <= activeStepIndex;

					if (!shouldShow) return null;

					const isActive = index === activeStepIndex;

					// Only the first step is typed from scratch, so only it shows the shortcut.
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
											{' to auto-complete '}
											{/* The chip the command becomes, taken from the step. */}
											<Text backgroundColor={theme.secondary}>
												{` ${step.command.split(' ').pop()} `}
											</Text>
										</Text>
									) : undefined
								}
							/>
							{/* The repository's addresses, so the step's numbers mean something. */}
							{step.key === 'emails' && !step.done && <EmailCandidates />}
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}
