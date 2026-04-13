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
	if (lastWord.endsWith(' ')) {
		return {
			hint: '',
			hints: [],
			overlap: 0,
			remainder: '',
		};
	}

	const hints = autoCompletionFromWordList({
		wordList,
		inputToMatch,
		overlapThreshold: 1,
	});

	return returnAutoCompletion(lastWord, hints);
};

const returnAutoCompletion = (
	lastWord: string,
	hints: string[],
): AutoCompletion => {
	const selectedHint = hints[0] ?? '';
	const overlap = findOverlap(
		lastWord.toLowerCase(),
		selectedHint.toLowerCase(),
	);
	const hint = selectedHint ? selectedHint + ' ' : '';
	const remainder = hint.slice(overlap);

	return {
		hint,
		hints,
		overlap,
		remainder,
	};
};
