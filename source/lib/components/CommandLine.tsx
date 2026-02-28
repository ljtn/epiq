import chalk from 'chalk';
import {Box, Text} from 'ink';
import React, {useEffect, useState} from 'react';
import {CmdKeywords} from '../command-line/command-line-sequence-intent.js';
import {
	commandLineState,
	getCmdValue,
	subscribeCommandLineState,
} from '../state/cmd.state.js';
import {chalkColors} from '../theme/themes.js';
import {findOverlap} from '../utils/stirng.utils.js';

export const CommandLine: React.FC = () => {
	const [input, setInput] = useState(getCmdValue());
	const [cursorPos, setCursorPos] = useState(commandLineState.cursorPosition);

	useEffect(() => {
		const unsubscribe = subscribeCommandLineState(() => {
			setInput(getCmdValue());
			setCursorPos(commandLineState.cursorPosition);
		});
		return () => {
			unsubscribe();
		};
	}, []);

	const safeCursor = Math.max(0, Math.min(cursorPos, input.length));

	const beforeCursor = input.slice(0, safeCursor);
	const cursorChar = safeCursor < input.length ? input[safeCursor] : ' ';
	const afterCursor =
		safeCursor < input.length ? input.slice(safeCursor + 1) : '';

	// ---- Command matching ----
	const commands = Object.values(CmdKeywords);
	const existingCommand = commands.find(cmd => input.startsWith(cmd + ' '));

	let renderedBefore = beforeCursor;
	let renderedAfter = afterCursor;
	let renderedCursor = chalk.inverse(cursorChar);

	if (existingCommand) {
		const commandLength = existingCommand.length;

		// Highlight command portion
		if (safeCursor <= commandLength) {
			renderedBefore = chalk.hex(chalkColors.cyan)(beforeCursor);
		} else {
			renderedBefore =
				chalk.hex(chalkColors.cyan)(existingCommand) +
				beforeCursor.slice(commandLength);
		}

		// Highlight cursor if inside command word
		if (safeCursor < commandLength) {
			renderedCursor = chalk.inverse.hex(chalkColors.cyan)(cursorChar);
		}
	}

	const hint = commandLineState.autoCompleteHint;
	if (hint) {
		const lastWord = commandLineState.value.split(' ').at(-1) + ' ' || '';
		let overlap = findOverlap(lastWord, hint);

		renderedCursor = chalk.inverse.gray(hint[overlap - 1] ?? cursorChar);
		renderedAfter = chalk.gray(hint.slice(overlap, hint.length) + afterCursor);
	}

	const fullLine =
		chalk.gray(':') + renderedBefore + renderedCursor + renderedAfter;

	return (
		<Box>
			<Text>{fullLine}</Text>
		</Box>
	);
};
