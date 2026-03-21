import {findOverlap} from '../utils/string.utils.js';
import {cmdModifiers} from './auto-completion-commands.js';
import {autoCompletionFromWordList} from './command-auto-complete.utils.js';
import {ParsedCommandLine} from './command-parser.js';
import {CmdKeywords} from './command-types.js';
import {DEFAULT_WORDS} from './default-word-list.js';

const CMD_KEYWORD_LIST = Object.values(CmdKeywords);

export type AutoCompletion = {
	hint: string;
	hints: string[];
	overlap: number;
	remainder: string;
};
export const getAutoCompletion = ({
	inputToMatch,
	command,
	lastWord,
	target,
}: ParsedCommandLine): AutoCompletion => {
	if (target === 'command') {
		return returnAutoCompletion(
			lastWord,
			autoCompletionFromWordList({
				wordList: CMD_KEYWORD_LIST,
				inputToMatch: inputToMatch,
				overlapThreshold: 1,
			}),
		);
	}

	if (command && target === 'modifier') {
		const commandHint = autoCompletionFromWordList({
			wordList: cmdModifiers[command],
			inputToMatch: inputToMatch,
			overlapThreshold: 1,
		});

		if (commandHint) {
			return returnAutoCompletion(lastWord, commandHint);
		}
	}

	const commandHint = autoCompletionFromWordList({
		wordList: DEFAULT_WORDS,
		inputToMatch: inputToMatch,
		overlapThreshold: 1,
	});

	if (commandHint) {
		return returnAutoCompletion(lastWord, commandHint);
	}

	return {hint: '', hints: [], overlap: 0, remainder: ''};
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
