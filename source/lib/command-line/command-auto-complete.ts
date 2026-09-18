import {findOverlap} from '../utils/string.utils.js';
import {autoCompletionFromWordList} from './command-auto-complete.utils.js';
import {ParsedCommandLine} from './command-parser.js';

export type AutoCompletion = {
	hint: string;
	hints: string[];
	overlap: number;
	remainder: string;
};
const EMPTY_AUTO_COMPLETION: AutoCompletion = {
	hint: '',
	hints: [],
	overlap: 0,
	remainder: '',
};

export const getAutoCompletion = (
	{inputToMatch, lastWord, isLastWordCompleted, inputString}: ParsedCommandLine,
	wordList: string[],
	/**
	 * What this command offers here, as opposed to the board's whole vocabulary.
	 * Only these can be filled in with nothing typed, and only when there is one
	 * of them: completing from the vocabulary would put an arbitrary ticket word
	 * in the line the moment somebody pressed tab.
	 */
	contextualWordList: string[] = [],
): AutoCompletion => {
	if (isLastWordCompleted || inputToMatch === '') {
		const [sole] = contextualWordList;

		// Nothing typed and only one thing it could be, so there is nothing to
		// disambiguate: tab fills it rather than asking for a first letter it
		// could only be given one way.
		return contextualWordList.length === 1 && sole && !inputString.trim()
			? returnAutoCompletion('', [sole])
			: EMPTY_AUTO_COMPLETION;
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

	const [base, variant] = selectedHint.split(':');
	const isAtBase = overlap < (base ?? '').length;
	const isCommaSeparatedWord = Boolean(variant);
	const pad = isCommaSeparatedWord && isAtBase ? ':' : ' ';

	const hint = isCommaSeparatedWord && isAtBase ? base : selectedHint;
	const completion = hint + pad;
	const remainder = completion.slice(overlap);

	return {
		hint: completion,
		hints,
		overlap,
		remainder,
	};
};
