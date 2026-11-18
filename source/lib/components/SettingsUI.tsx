import {Box, Text} from 'ink';
import React from 'react';
import {theme} from '../theme/themes.js';
import {truncateToWidth} from '../utils/string.utils.js';
import {getUserSetupStatus} from '../config/setup-utils.js';
import {EmailCandidates} from './EmailCandidates.js';
import {useSetupSession} from '../state/setup-session.state.js';
import {useAppState} from '../state/state.js';
import {Mode} from '../model/action-map.model.js';

type Props = {
	width: number;
	height: number;
};

type StepRowProps = {
	isDone: boolean;
	command: string;
	value?: string;
	verb?: string;
};

const StepRow: React.FC<StepRowProps> = ({
	isDone,
	command,
	value,
	verb = 'Type',
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
		</Box>
	);
};

/**
 * The claimed addresses, fitted to the step row's width. 34: the row spends about 28
 * columns on its tick, verb and command, and the box has a border either side.
 */
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
		isSetUserName,
		userName,
		autoSync,
		isSetAutoSync,
		isSetEmails,
		claimedEmails,
		emailSetupDeclined,
	} = getUserSetupStatus();
	const {rerunStep} = useSetupSession();
	// Esc closes the line a step opened; the step then says what to type.
	const lineOpen = useAppState().mode === Mode.COMMAND_LINE;
	const steps = [
		{
			key: 'username',
			done: isSetUserName,
			command: ':config username',
			value: userName,
			message:
				'First, the name others see on the board. Enter keeps it, or change it first.',
		},
		{
			key: 'autoSync',
			done: isSetAutoSync,
			command: ':config autosync',
			value: autoSync,
			message:
				'Auto sync keeps the board current with your team. Enter keeps it on.',
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
				'Last one. Claim the git addresses whose commits are yours, so the board calls them by your Epiq name.',
		},
	];

	// A rerun walks every machine step, answered or not.
	const activeStepIndex = rerunStep
		? steps.findIndex(step => step.key === rerunStep)
		: steps.findIndex(step => !step.done);
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
				{rerunStep ? 'Setup' : 'Welcome! 🔹'}
			</Text>

			<Text>
				{rerunStep
					? 'Confirm each answer with enter, or change it first. Esc leaves setup.'
					: "Let's get you started - it's a breeze."}
			</Text>
			{/* A rerun's header already says what to do. */}
			{activeStep && !rerunStep && (
				<Text color={theme.secondary2}>{activeStep.message}</Text>
			)}

			<Box flexDirection="column">
				{steps.map((step, index) => {
					const shouldShow = activeStepIndex === -1 || index <= activeStepIndex;

					if (!shouldShow) return null;

					const isActive = index === activeStepIndex;
					const isDone = rerunStep ? index < activeStepIndex : step.done;

					return (
						<Box key={step.key} flexDirection="column" marginBottom={1}>
							<StepRow
								isDone={isDone}
								command={step.command}
								value={isDone ? formatValue(step.value) : undefined}
								verb={isActive && lineOpen ? 'Waiting:' : 'Type'}
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
