import chalk from 'chalk';
import {Box, Text} from 'ink';
import React, {useEffect, useMemo, useState} from 'react';
import {AutoCompletion} from '../command-line/command-auto-complete.js';
import {CmdKeyword, CmdValidity} from '../command-line/command-types.js';
import {
	commandLineState,
	subscribeCommandLineState,
} from '../state/cmd.state.js';
import {chalkColors, theme} from '../theme/themes.js';

type CommandLineViewState = {
	value: string;
	cursorPosition: number;
	commandIsPending: boolean;
	infoMessage: string;
	autoCompletion: AutoCompletion;
	validationStatus: CmdValidity;
	command: CmdKeyword | null;
	modifier: string;
	inputString: string;
};

const COLOR_COMMAND = chalk.hex(chalkColors.blue);
const COLOR_MODIFIER = chalk.white.bgGray;
const GRAY = chalk.gray;
const INVERSE = chalk.inverse;
const INVERSE_CYAN = chalk.inverse.hex(chalkColors.blue);
const INVERSE_GREEN = chalk.inverse.green;
const INVERSE_GRAY = chalk.inverse.gray;

const EMPTY_AUTO_COMPLETION: AutoCompletion = {
	hint: '',
	hints: [],
	overlap: 0,
	remainder: '',
};

const getCommandRange = ({
	value,
	command,
}: {
	value: string;
	command: CmdKeyword | null;
}): {start: number; end: number} | null => {
	if (!command) return null;

	const trimmedStart = value.trimStart();
	const leadingWhitespace = value.length - trimmedStart.length;
	const commandStart = leadingWhitespace;

	if (value.slice(commandStart, commandStart + command.length) !== command) {
		return null;
	}

	return {
		start: commandStart,
		end: commandStart + command.length,
	};
};

const getModifierRange = ({
	value,
	command,
	modifier,
}: {
	value: string;
	command: CmdKeyword | null;
	modifier: string;
}): {start: number; end: number} | null => {
	if (!command || !modifier) return null;

	const commandRange = getCommandRange({value, command});
	if (!commandRange) return null;

	const afterCommand = value.slice(commandRange.end);
	const spacing = afterCommand.match(/^\s*/)?.[0].length ?? 0;
	const modifierStart = commandRange.end + spacing;

	if (
		value.slice(modifierStart, modifierStart + modifier.length) !== modifier
	) {
		return null;
	}

	return {
		start: modifierStart,
		end: modifierStart + modifier.length,
	};
};

const getCommandLineViewState = (): CommandLineViewState => ({
	value: commandLineState.value,
	cursorPosition: commandLineState.cursorPosition,
	commandIsPending: commandLineState.commandIsPending,
	autoCompletion: commandLineState.autoCompletion ?? EMPTY_AUTO_COMPLETION,
	infoMessage: commandLineState.commandMeta.infoMessage,
	validationStatus: commandLineState.commandMeta.validity,
	command: commandLineState.commandMeta.command,
	inputString: commandLineState.commandMeta.inputString,
	modifier: commandLineState.commandMeta.modifier,
});

const isEqual = (a: CommandLineViewState, b: CommandLineViewState): boolean =>
	a.value === b.value &&
	a.cursorPosition === b.cursorPosition &&
	a.commandIsPending === b.commandIsPending &&
	a.infoMessage === b.infoMessage &&
	a.autoCompletion.hint === b.autoCompletion.hint &&
	a.autoCompletion.overlap === b.autoCompletion.overlap &&
	a.autoCompletion.remainder === b.autoCompletion.remainder &&
	a.validationStatus === b.validationStatus &&
	a.command === b.command &&
	a.modifier === b.modifier &&
	a.inputString === b.inputString;

export const CommandLine: React.FC<{width: number}> = ({width}) => {
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

	const {
		value,
		cursorPosition,
		infoMessage,
		commandIsPending,
		autoCompletion,
		command,
		modifier,
	} = state;

	const fullLine = useMemo(() => {
		const safeCursor = Math.max(0, Math.min(cursorPosition, value.length));
		const commandRange = getCommandRange({value, command});
		const modifierRange = getModifierRange({value, command, modifier});

		const styleCharAt = (char: string, index: number): string => {
			const isCommandChar =
				commandRange && index >= commandRange.start && index < commandRange.end;

			const isModifierChar =
				modifierRange &&
				index >= modifierRange.start &&
				index < modifierRange.end;

			if (isCommandChar) return COLOR_COMMAND(char);
			if (isModifierChar) return COLOR_MODIFIER(char);
			return char;
		};

		const styleCursorAt = (char: string, index: number): string => {
			const isCommandChar =
				commandRange && index >= commandRange.start && index < commandRange.end;

			const isModifierChar =
				modifierRange &&
				index >= modifierRange.start &&
				index < modifierRange.end;

			if (isCommandChar) return INVERSE_CYAN(char);
			if (isModifierChar) return INVERSE_GREEN(char);
			return INVERSE(char);
		};

		const beforeCursor = value.slice(0, safeCursor);
		const cursorChar = value[safeCursor] ?? ' ';
		const afterCursor =
			safeCursor < value.length ? value.slice(safeCursor + 1) : '';

		let renderedBefore = Array.from(beforeCursor)
			.map((char, index) => styleCharAt(char, index))
			.join('');

		let renderedCursor = styleCursorAt(cursorChar, safeCursor);

		let renderedAfter = Array.from(afterCursor)
			.map((char, offset) => styleCharAt(char, safeCursor + 1 + offset))
			.join('');

		if (autoCompletion.hint) {
			const hintedChar =
				autoCompletion.hint[autoCompletion.overlap] ?? cursorChar;

			renderedCursor = INVERSE_GRAY(hintedChar);
			renderedAfter = GRAY(autoCompletion.remainder.slice(1) + afterCursor);
		}

		return GRAY(':') + renderedBefore + renderedCursor + renderedAfter;
	}, [value, cursorPosition, autoCompletion, command, modifier]);

	return (
		<Box
			flexDirection="column"
			paddingX={1}
			borderColor={theme.secondary}
			borderStyle="round"
			width={width}
		>
			<Box>
				<Text>{fullLine}</Text>
				{infoMessage && (
					<Text color={commandIsPending ? 'red' : theme.secondary}>
						{` ${infoMessage} `}
					</Text>
				)}
			</Box>
		</Box>
	);
};
