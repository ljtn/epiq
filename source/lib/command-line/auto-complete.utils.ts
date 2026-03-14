import {findOverlap} from '../utils/string.utils.js';
import {CmdKeywords, CmdMeta, isCmdKeyword} from './cmd-utils.js';
import {wordList} from './word-list.js';

export const getHint = (value: string): string => {
	const trimmedStart = value.trimStart();
	const words = trimmedStart ? trimmedStart.split(/\s+/) : [];
	const isSingleWord = words.length === 1;
	const [firstWord] = words;
	const firstWordIsCmdKeyword = isCmdKeyword(firstWord ?? '');
	const isLastWordCompleted = value.endsWith(' ');

	const modifierInput = firstWord
		? trimmedStart.slice(firstWord.length).trimStart()
		: '';

	const targetIsModifier =
		firstWordIsCmdKeyword && modifierInput && !isLastWordCompleted;

	if (isSingleWord && firstWord) {
		return returnHint(getCommandHint(firstWord));
	}

	if (targetIsModifier && firstWord) {
		const autoCompleteHints = isCmdKeyword(firstWord)
			? CmdMeta[firstWord].autoCompleteHints
			: [];

		return returnHint(getModifierHint(autoCompleteHints, modifierInput));
	}

	return returnHint(getWordHint(value));
};

const returnHint = (hint: string) => (hint ? hint + ' ' : '');

const getModifierHint = (wordList: string[], inputToMatch: string) => {
	return hintFromWordList({
		wordList,
		inputToMatch: getLastWord(inputToMatch),
		overlapThreshold: 1,
	});
};

const getCommandHint = (command: string) => {
	return hintFromWordList({
		wordList: Object.values(CmdKeywords),
		inputToMatch: getLastWord(command),
		overlapThreshold: 1,
	});
};

const getWordHint = (command: string) => {
	return hintFromWordList({
		wordList,
		inputToMatch: getLastWord(command),
		overlapThreshold: 3,
	});
};

const getLastWord = (str: string) => {
	if (!str) {
		return '';
	}

	const words = str.split(/\s+/);
	return (words.at(-1) || '').trim();
};

const hintFromWordList = ({
	wordList,
	inputToMatch,
	overlapThreshold = 1,
}: {
	wordList: string[];
	inputToMatch: string;
	overlapThreshold?: number;
}) => {
	const hint = wordList.find(
		term =>
			term.startsWith(inputToMatch) &&
			findOverlap(inputToMatch, term) >= overlapThreshold,
	);

	return hint || '';
};
