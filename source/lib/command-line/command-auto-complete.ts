import {findOverlap} from '../utils/string.utils.js';
import {autoCompletionFromWordList} from './command-auto-complete.utils.js';
import {ParsedCommandLine} from './command-parser.js';

export type AutoCompletion = {
	hint: string;
	hints: string[];
	overlap: number;
	remainder: string;
};
export const getAutoCompletion = (
	{inputToMatch, lastWord}: ParsedCommandLine,
	wordList: string[],
): AutoCompletion => {
	const commandHint = autoCompletionFromWordList({
		wordList,
		inputToMatch: inputToMatch,
		overlapThreshold: 1,
	});

	return returnAutoCompletion(lastWord, commandHint);
};

const returnAutoCompletion = (
	lastWord: string,
	hints: string[],
): AutoCompletion => {
	const selectedHint = hints[0] ?? '';
	const hint = selectedHint ? selectedHint + ' ' : '';
	const input = `${lastWord} `;
	const overlap = findOverlap(input.toLowerCase(), hint.toLowerCase());
	const remainder = hint.slice(overlap);

	const autoCompletion: AutoCompletion = {
		hint,
		hints,
		overlap,
		remainder,
	};
	return autoCompletion;
};
