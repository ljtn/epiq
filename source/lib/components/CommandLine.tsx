import {Box, Text} from 'ink';
import React, {useEffect, useState} from 'react';
import {
	commandLineState,
	getCommandLineInput,
	subscribeCommandLineState,
} from '../navigation/state/command-line.state.js';
import {theme} from '../theme/themes.js';

const syntaxHighlight = {
	command: theme.accent,
	argument: theme.primary,
	autoComplete: theme.secondary,
} as const;
const getAutoCompleteHint = (input: string | undefined) => {
	const remainingAutocomplete = commandLineState.autoCompleteHint?.slice(
		input?.length || 0,
	);
	return remainingAutocomplete ?? '';
};

export const CommandLine: React.FC = () => {
	const [input, setInput] = useState(getCommandLineInput());
	const [caretBlink, setCaretBlink] = useState('');

	useEffect(() => {
		setInterval(() => {
			setCaretBlink(c => (c === ' ' ? '_' : ' '));
		}, 850);

		const unsubscribe = subscribeCommandLineState(() => {
			setInput(getCommandLineInput());
		});
		return () => {
			unsubscribe();
		};
	}, []);

	const [command, ...rest] = input.split(' ');
	const autoCompleteSuggestion = getAutoCompleteHint(command);
	const argument = rest.join(' ');
	const caret = input.length === 0 ? '' : caretBlink;
	return (
		<Box>
			<Text>:</Text>
			{command && (
				<Text color={syntaxHighlight.command}>
					{command + (rest.length ? ' ' : '')}
				</Text>
			)}

			{/* Add citation marks around text */}
			{argument && <Text color={syntaxHighlight.argument}>{'"'}</Text>}

			{argument && (
				<Text>
					<Text color={syntaxHighlight.argument}>{argument}</Text>
				</Text>
			)}
			<Text color={theme.accent}>{caret}</Text>

			{/* End citation marks around text */}
			{argument && <Text color={syntaxHighlight.argument}>{'"'}</Text>}

			{/* Add autocomplete after caret */}
			{autoCompleteSuggestion && (
				<Text color={syntaxHighlight.autoComplete}>
					{autoCompleteSuggestion}
				</Text>
			)}
		</Box>
	);
};
