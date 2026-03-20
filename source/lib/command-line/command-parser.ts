import {isCmdKeyword} from './command-meta.js';
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
	modifierInput: string;
	target: CommandTarget;
	inputToMatch: string;
};

export const parseCommandLine = (raw: string): ParsedCommandLine => {
	const trimmedStart = raw.trimStart();
	const words = splitWords(trimmedStart);
	const firstWord = words[0] ?? '';
	const hasCommand = firstWord !== '';
	const command = isCmdKeyword(firstWord) ? firstWord : null;
	const isCommandKeyword = command !== null;
	const isLastWordCompleted = raw.endsWith(' ');

	const modifierInput = hasCommand
		? trimmedStart.slice(firstWord.length).trimStart()
		: '';

	const target = getTarget({
		hasCommand,
		isCommandKeyword,
		modifierInput,
		wordCount: words.length,
		isLastWordCompleted,
	});

	const inputToMatch =
		target === 'modifier' ? getLastWord(modifierInput) : getLastWord(raw);

	return {
		raw,
		trimmedStart,
		words,
		firstWord,
		lastWord: getLastWord(raw),
		hasCommand,
		command,
		isCommandKeyword,
		isLastWordCompleted,
		modifierInput,
		target,
		inputToMatch,
	};
};

const getTarget = ({
	hasCommand,
	isCommandKeyword,
	modifierInput,
	wordCount,
	isLastWordCompleted,
}: {
	hasCommand: boolean;
	isCommandKeyword: boolean;
	modifierInput: string;
	wordCount: number;
	isLastWordCompleted: boolean;
}): CommandTarget => {
	if (hasCommand && wordCount === 1) {
		return 'command';
	}

	if (isCommandKeyword && modifierInput !== '' && !isLastWordCompleted) {
		return 'modifier';
	}

	return 'word';
};

const splitWords = (value: string): string[] =>
	value === '' ? [] : value.split(/\s+/);

const getLastWord = (value: string): string =>
	value.trimEnd().split(/\s+/).at(-1) ?? '';
