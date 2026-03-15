import {findOverlap} from '../utils/string.utils.js';
import {CmdMeta} from './command-registry.js';
import {CmdKeywords} from './command-types.js';
import {parseCommandLine} from './command-parser.js';
import {wordList} from './default-word-list.js';

export const getAutoCompletion = (value: string): string => {
	const parsed = parseCommandLine(value);

	if (parsed.targetIsCommand) {
		return returnAutoCompletion(
			autoCompletionFromWordList({
				wordList: Object.values(CmdKeywords),
				inputToMatch: parsed.lastWord,
				overlapThreshold: 1,
			}),
		);
	}

	if (parsed.targetIsModifier && parsed.command) {
		return returnAutoCompletion(
			autoCompletionFromWordList({
				wordList: CmdMeta[parsed.command].autoCompleteHints,
				inputToMatch: parsed.lastWord,
				overlapThreshold: 1,
			}),
		);
	}

	return returnAutoCompletion(
		autoCompletionFromWordList({
			wordList,
			inputToMatch: parsed.lastWord,
			overlapThreshold: 3,
		}),
	);
};

const returnAutoCompletion = (hint: string) => (hint ? hint + ' ' : '');

const autoCompletionFromWordList = ({
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
