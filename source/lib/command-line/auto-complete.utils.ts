import {findOverlap} from '../utils/string.utils.js';
import {CmdKeywords, CmdMeta, isCmdKeyword} from './cmd-utils.js';
import {wordList} from './word-list.js';

export const getHint = (value: string): string => {
	const words = value.trimStart() ? value.trimStart().split(/\s+/) : [];
	const isSingleWord = words.length === 1;
	const [firstWord, secondWord] = words;
	const firstWordIsCmdKeyword = isCmdKeyword(firstWord ?? '');
	const isLastWordCompleted = value?.endsWith(' ');

	const targetIsModifier =
		firstWordIsCmdKeyword && firstWord && secondWord && !isLastWordCompleted;

	if (isSingleWord && firstWord) {
		return returnHint(getCommandHint(firstWord));
	} else if (targetIsModifier) {
		const autoCompleteHints = isCmdKeyword(firstWord)
			? CmdMeta[firstWord].autoCompleteHints
			: [];
		return returnHint(getModifierHint(autoCompleteHints, secondWord ?? ''));
	}
	return returnHint(getWordHint(value));
};

const returnHint = (hint: string) => (hint ? hint + ' ' : '');

const getModifierHint = (wordList: string[], inputToMatch: string) => {
	return hintFromWordList({
		wordList,
		inputToMatch,
		overlapThreshold: 0,
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
		wordList: [...wordList],
		inputToMatch: getLastWord(command),
		overlapThreshold: 3,
	});
};

const getLastWord = (str: string) => {
	if (!str) {
		return '';
	}
	const words = str.split(' ');
	const lastWord = words.at(-1) || '';
	return lastWord.trim();
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
