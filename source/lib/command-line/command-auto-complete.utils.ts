import {findOverlap} from '../utils/string.utils.js';
import {
	createPrefixIndex,
	getPrefixMatches,
	PrefixIndex,
} from './command-auto-complete-index.js';

const indexCache = new WeakMap<string[], PrefixIndex>();

export const getPrefixIndex = (wordList: string[]): PrefixIndex => {
	let index = indexCache.get(wordList);

	if (!index) {
		index = createPrefixIndex(wordList);
		indexCache.set(wordList, index);
	}

	return index;
};

export const getCompletionSuffix = ({
	input,
	match,
}: {
	input: string;
	match: string;
}) => {
	if (!match) {
		return '';
	}

	return match.slice(input.length);
};

export const autoCompletionFromWordList = ({
	wordList,
	inputToMatch,
	overlapThreshold = 1,
}: {
	wordList: string[];
	inputToMatch: string;
	overlapThreshold?: number;
}): string[] => {
	const normalizedInput = inputToMatch.toLowerCase();

	const matches = getPrefixMatches(getPrefixIndex(wordList), normalizedInput);

	return matches.filter(
		term => findOverlap(normalizedInput, term) >= overlapThreshold,
	);
};
