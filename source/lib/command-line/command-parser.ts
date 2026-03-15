import {isCmdKeyword} from './command-meta.js';
import {CmdKeyword} from './command-types.js';

export type ParsedCommandLine = {
	raw: string;
	trimmedStart: string;
	words: string[];
	firstWord: string;
	hasCommand: boolean;
	command: CmdKeyword | null;
	isCommandKeyword: boolean;
	isLastWordCompleted: boolean;
	modifierInput: string;
	targetIsCommand: boolean;
	targetIsModifier: boolean;
	targetIsWord: boolean;
	lastWord: string;
};

export const parseCommandLine = (value: string): ParsedCommandLine => {
	const raw = value;
	const trimmedStart = raw.trimStart();
	const words = trimmedStart
		? trimmedStart.split(/\s+/).map(e => e.trim())
		: [];
	const firstWord = (words[0] ?? '').trim();
	const hasCommand = firstWord.length > 0;
	const isCommandKeyword = isCmdKeyword(firstWord);
	const isLastWordCompleted = raw.endsWith(' ');

	const modifierInput = hasCommand
		? trimmedStart.slice(firstWord.length).trimStart()
		: '';

	const targetIsCommand = words.length === 1 && hasCommand;
	const targetIsModifier =
		isCommandKeyword && modifierInput.length > 0 && !isLastWordCompleted;
	const targetIsWord = !targetIsCommand && !targetIsModifier;

	return {
		raw,
		trimmedStart,
		words,
		firstWord,
		hasCommand,
		command: isCmdKeyword(firstWord) ? firstWord : null,
		isCommandKeyword,
		isLastWordCompleted,
		modifierInput,
		targetIsCommand,
		targetIsModifier,
		targetIsWord,
		lastWord: getLastWord(targetIsModifier ? modifierInput : raw),
	};
};

const getLastWord = (str: string): string => {
	if (!str) {
		return '';
	}

	const words = str.split(/\s+/);
	return (words.at(-1) || '').trim();
};
