import chalk from 'chalk';
import {Box, Text} from 'ink';
import React, {useEffect, useState} from 'react';
import {
	commandLineState,
	subscribeCommandLineState,
} from '../state/cmd.state.js';
import {CmdKeywords} from '../command-line/command-types.js';
import {chalkColors} from '../theme/themes.js';
import {findOverlap} from '../utils/string.utils.js';

type CommandLineViewState = {
	value: string;
	cursorPosition: number;
	commandIsPending: boolean;
	infoHint: string;
	autoCompleteHint: string;
};

const getCommandLineViewState = (): CommandLineViewState => ({
	value: commandLineState.value,
	cursorPosition: commandLineState.cursorPosition,
	commandIsPending: commandLineState.commandIsPending,
	infoHint: commandLineState.commandMeta.infoHint,
	autoCompleteHint: commandLineState.autoCompleteHint,
});

const isEqual = (a: CommandLineViewState, b: CommandLineViewState): boolean =>
	a.value === b.value &&
	a.cursorPosition === b.cursorPosition &&
	a.commandIsPending === b.commandIsPending &&
	a.infoHint === b.infoHint &&
	a.autoCompleteHint === b.autoCompleteHint;

export const CommandLine: React.FC = () => {
	const [state, setState] = useState<CommandLineViewState>(
		getCommandLineViewState(),
	);

	useEffect(() => {
		const sync = () => {
			const next = getCommandLineViewState();
			setState(prev => (isEqual(prev, next) ? prev : next));
		};

		const unsubscribe = subscribeCommandLineState(sync);
		sync();
		return () => {
			unsubscribe();
		};
	}, []);

	const {value, cursorPosition, commandIsPending, infoHint, autoCompleteHint} =
		state;

	const safeCursor = Math.max(0, Math.min(cursorPosition, value.length));

	const beforeCursor = value.slice(0, safeCursor);
	const cursorChar = safeCursor < value.length ? value[safeCursor] : ' ';
	const afterCursor =
		safeCursor < value.length ? value.slice(safeCursor + 1) : '';

	const commands = Object.values(CmdKeywords);
	const existingCommand = commands.find(cmd => value.startsWith(cmd + ' '));

	let renderedBefore = beforeCursor;
	let renderedAfter = afterCursor;
	let renderedCursor = chalk.inverse(cursorChar);

	if (existingCommand) {
		const commandLength = existingCommand.length;

		if (safeCursor <= commandLength) {
			renderedBefore = chalk.hex(chalkColors.cyan)(beforeCursor);
		} else {
			renderedBefore =
				chalk.hex(chalkColors.cyan)(existingCommand) +
				beforeCursor.slice(commandLength);
		}

		if (safeCursor < commandLength) {
			renderedCursor = chalk.inverse.hex(chalkColors.cyan)(cursorChar);
		}
	}

	if (autoCompleteHint) {
		const lastWord = value.split(' ').at(-1) + ' ' || '';
		const overlap = findOverlap(lastWord, autoCompleteHint);

		renderedCursor = chalk.inverse.gray(
			autoCompleteHint[overlap - 1] ?? cursorChar,
		);
		renderedAfter = chalk.gray(autoCompleteHint.slice(overlap) + afterCursor);
	}

	const fullLine =
		chalk.gray(':') + renderedBefore + renderedCursor + renderedAfter;

	logger.info('hehe');
	return (
		<Box>
			<Text>{fullLine}</Text>
			{commandIsPending && infoHint && (
				<Box paddingLeft={2}>
					<Text color="red">{` ${infoHint} `}</Text>
				</Box>
			)}
		</Box>
	);
};
