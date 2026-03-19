import chalk from 'chalk';
import {Box, Text} from 'ink';
import React, {useEffect, useMemo, useState} from 'react';
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

const COMMANDS = Object.values(CmdKeywords);
const CYAN = chalk.hex(chalkColors.cyan);
const GRAY = chalk.gray;
const INVERSE = chalk.inverse;
const INVERSE_CYAN = chalk.inverse.hex(chalkColors.cyan);
const INVERSE_GRAY = chalk.inverse.gray;

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

const getLastWord = (value: string): string => {
	const trimmed = value.trimEnd();
	const lastSpace = trimmed.lastIndexOf(' ');
	return lastSpace === -1 ? trimmed : trimmed.slice(lastSpace + 1);
};

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

	const fullLine = useMemo(() => {
		const safeCursor = Math.max(0, Math.min(cursorPosition, value.length));

		const beforeCursor = value.slice(0, safeCursor);
		const cursorChar = safeCursor < value.length ? value[safeCursor] : ' ';
		const afterCursor =
			safeCursor < value.length ? value.slice(safeCursor + 1) : '';

		const existingCommand = COMMANDS.find(
			cmd => value.startsWith(cmd) && value[cmd.length] === ' ',
		);

		let renderedBefore = beforeCursor;
		let renderedAfter = afterCursor;
		let renderedCursor = INVERSE(cursorChar);

		if (existingCommand) {
			const commandLength = existingCommand.length;

			if (safeCursor <= commandLength) {
				renderedBefore = CYAN(beforeCursor);
			} else {
				renderedBefore =
					CYAN(existingCommand) + beforeCursor.slice(commandLength);
			}

			if (safeCursor < commandLength) {
				renderedCursor = INVERSE_CYAN(cursorChar);
			}
		}

		if (autoCompleteHint) {
			const lastWord = getLastWord(value);
			const overlap = findOverlap(`${lastWord} `, autoCompleteHint);

			renderedCursor = INVERSE_GRAY(
				autoCompleteHint[overlap - 1] ?? cursorChar,
			);
			renderedAfter = GRAY(autoCompleteHint.slice(overlap) + afterCursor);
		}

		return GRAY(':') + renderedBefore + renderedCursor + renderedAfter;
	}, [value, cursorPosition, autoCompleteHint]);

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
