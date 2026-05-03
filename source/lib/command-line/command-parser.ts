import {isCmdKeyword} from './command-meta.js';
import {getCmdModifiers} from './command-modifiers.js';
import {CmdKeyword} from './cmd-keywords.js';

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

	const firstWord = words[0] ?? '';
	const secondWord = words[1] ?? '';

	const isLastWordCompleted = /\s$/.test(raw);
	const lastWord = getLastWord(raw);

	const command = isCmdKeyword(firstWord) ? firstWord : null;
	const isCommandKeyword = command !== null;
	const hasCommand = firstWord !== '';

	const modifiers = command ? getCmdModifiers(command) ?? [] : [];
	const modifier = command && modifiers.includes(secondWord) ? secondWord : '';

	let target: CommandTarget = 'word';

	if (words.length === 0) {
		target = 'command';
	} else if (words.length === 1 && !isLastWordCompleted) {
		target = 'command';
	} else if (
		(words.length === 1 && isLastWordCompleted) ||
		(words.length === 2 && !isLastWordCompleted)
	) {
		target = 'modifier';
	}

	const inputToMatch = isLastWordCompleted ? '' : lastWord;

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
		inputToMatch,
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
	value.trim() ? value.trim().split(/\s+/) : [];

const getLastWord = (value: string): string =>
	value.trimEnd().split(/\s+/).at(-1) ?? '';
