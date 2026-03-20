import chalk from 'chalk';
import {Box, Text} from 'ink';
import React, {useEffect, useMemo, useState} from 'react';
import {
	commandLineState,
	subscribeCommandLineState,
} from '../state/cmd.state.js';
import {CmdKeywords} from '../command-line/command-types.js';
import {chalkColors} from '../theme/themes.js';
import {AutoCompletion} from '../command-line/command-auto-complete.js';

type CommandLineViewState = {
	value: string;
	cursorPosition: number;
	commandIsPending: boolean;
	infoMessage: string;
	autoCompletion: AutoCompletion;
};

const COMMANDS = Object.values(CmdKeywords);
const CYAN = chalk.hex(chalkColors.cyan);
const GRAY = chalk.gray;
const INVERSE = chalk.inverse;
const INVERSE_CYAN = chalk.inverse.hex(chalkColors.cyan);
const INVERSE_GRAY = chalk.inverse.gray;

const EMPTY_AUTO_COMPLETION: AutoCompletion = {
	hint: '',
	hints: [],
	overlap: 0,
	remainder: '',
};

const getCommandLineViewState = (): CommandLineViewState => ({
	value: commandLineState.value,
	cursorPosition: commandLineState.cursorPosition,
	commandIsPending: commandLineState.commandIsPending,
	infoMessage: commandLineState.commandMeta.infoMessage,
	autoCompletion: commandLineState.autoCompletion ?? EMPTY_AUTO_COMPLETION,
});

const isEqual = (a: CommandLineViewState, b: CommandLineViewState): boolean =>
	a.value === b.value &&
	a.cursorPosition === b.cursorPosition &&
	a.commandIsPending === b.commandIsPending &&
	a.infoMessage === b.infoMessage &&
	a.autoCompletion.hint === b.autoCompletion.hint &&
	a.autoCompletion.overlap === b.autoCompletion.overlap &&
	a.autoCompletion.remainder === b.autoCompletion.remainder;

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

	const {value, cursorPosition, infoMessage, commandIsPending, autoCompletion} =
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

		if (autoCompletion.hint) {
			const hintedChar =
				autoCompletion.hint[autoCompletion.overlap] ?? cursorChar;

			renderedCursor = INVERSE_GRAY(hintedChar);
			renderedAfter = GRAY(autoCompletion.remainder.slice(1) + afterCursor);
		}

		return GRAY(':') + renderedBefore + renderedCursor + renderedAfter;
	}, [value, cursorPosition, autoCompletion]);

	return (
		<Box>
			<Text>{fullLine}</Text>
			{infoMessage && (
				<Box paddingLeft={2}>
					<Text
						color={commandIsPending ? 'red' : 'blue'}
					>{` ${infoMessage} `}</Text>
				</Box>
			)}
		</Box>
	);
};
