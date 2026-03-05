import {findOverlap} from '../utils/string.utils.js';
import {wordList} from './word-list.js';
import {CmdKeyword, CmdKeywords, CmdMeta, isCmdKeyword} from './cmd-utils.js';

export const getHint = (value: string): string => {
	// Slit words
	const words = value.split(' ');
	const isSingleWord = words.length === 1;
	const [firstWord, secondWord] = words;
	const firstWordIsCmdKeyword = isCmdKeyword(words[0] as CmdKeyword);

	// Pick hint
	let hint = '';
	if (isSingleWord && firstWord) {
		hint = getCommandHint(firstWord);
	} else if (firstWordIsCmdKeyword && firstWord && !secondWord?.length) {
		const meta = CmdMeta[firstWord as keyof typeof CmdMeta];
		if (meta) {
			hint = meta.hint;
		} else {
			hint = getWordHint(value);
		}
	} else {
		hint = getWordHint(value);
	}

	const trailingSpace = ' ';
	return hint + trailingSpace;
};

const getCommandHint = (command: string) => {
	return hintFromWordList(Object.values(CmdKeywords), command, 1);
};
const getWordHint = (command: string) => {
	return hintFromWordList([...wordList], command, 3);
};

const hintFromWordList = (
	wordList: string[],
	command: string,
	overlapThreshold = 1,
) => {
	if (!command) return '';

	const words = command.split(' ');
	const lastWord = words.at(-1) || '';
	if (!lastWord) return '';

	const hint = wordList.find(
		term =>
			term.startsWith(lastWord) &&
			findOverlap(lastWord, term) >= overlapThreshold,
	);

	return hint || '';
};
