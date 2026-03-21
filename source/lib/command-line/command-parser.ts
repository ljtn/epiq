import {isCmdKeyword} from './command-meta.js';
import {getCmdModifiers} from './command-modifiers.js';
import {CmdKeyword} from './command-types.js';

export type CommandTarget = 'command' | 'modifier' | 'word';

export type ParsedCommandLine = {
	raw: string;
	trimmedStart: string;
	words: string[];
	firstWord: string;
	lastWord: string;
	hasCommand: boolean;
	command: CmdKeyword | null;
	isCommandKeyword: boolean;
	isLastWordCompleted: boolean;
	modifier: string;
	target: CommandTarget;
	inputToMatch: string;
	inputString: string; // 👈 NEW
};

export const parseCommandLine = (raw: string): ParsedCommandLine => {
	const trimmedStart = raw.trimStart();
	const words = splitWords(trimmedStart);

	const firstWord = (words[0] ?? '').trimStart().trimEnd();
	const secondWord = (words[1] ?? '').trimStart().trimEnd();
	const lastWord = getLastWord(raw);

	const command = isCmdKeyword(firstWord) ? firstWord : null;
	const isCommandKeyword = command !== null;
	const hasCommand = firstWord !== '';
	const isLastWordCompleted = raw.endsWith(' ');

	const modifiers = command ? getCmdModifiers()[command] : [];
	const modifier = command && modifiers.includes(secondWord) ? secondWord : '';

	let target: CommandTarget = 'word';

	if (words.length <= 1) {
		target = 'command';
	} else if (words.length === 2) {
		target = 'modifier';
	}
	const inputString = extractInputString(trimmedStart, command, modifier);

	return {
		raw,
		trimmedStart,
		words,
		firstWord,
		lastWord,
		hasCommand,
		command,
		isCommandKeyword,
		isLastWordCompleted,
		modifier,
		target,
		inputToMatch: lastWord,
		inputString,
	};
};

const extractInputString = (
	value: string,
	command: string | null,
	modifier: string,
): string => {
	let rest = value;

	if (command && rest.startsWith(command)) {
		rest = rest.slice(command.length);
	}

	// remove leading space(s) after command
	rest = rest.replace(/^\s+/, '');

	if (modifier && rest.startsWith(modifier)) {
		rest = rest.slice(modifier.length);
		rest = rest.replace(/^\s+/, '');
	}

	return rest;
};

const splitWords = (value: string): string[] =>
	value ? value.split(/\s+/) : [];

const getLastWord = (value: string): string =>
	value.trimEnd().split(/\s+/).at(-1) ?? '';
