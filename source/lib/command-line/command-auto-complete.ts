import {CmdMeta} from './command-registry.js';
import {CmdKeywords} from './command-types.js';
import {parseCommandLine, ParsedCommandLine} from './command-parser.js';
import {DEFAULT_WORDS} from './default-word-list.js';
import {autoCompletionFromWordList} from './command-auto-complete.utils.js';
import {findOverlap} from '../utils/string.utils.js';

const CMD_KEYWORD_LIST = Object.values(CmdKeywords);

export type AutoCompletion = {
	hint: string;
	hints: string[];
	overlap: number;
	remainder: string;
};
export const getAutoCompletion = (value: string): AutoCompletion => {
	const parsed = parseCommandLine(value);

	if (parsed.target === 'command') {
		return returnAutoCompletion(
			parsed,
			autoCompletionFromWordList({
				wordList: CMD_KEYWORD_LIST,
				inputToMatch: parsed.inputToMatch,
				overlapThreshold: 1,
			}),
		);
	}

	if (parsed.command && parsed.target === 'modifier') {
		const contextualHints = CmdMeta[parsed.command].hints;
		const wordList = contextualHints.length ? contextualHints : DEFAULT_WORDS;
		const commandHint = autoCompletionFromWordList({
			wordList,
			inputToMatch: parsed.inputToMatch,
			overlapThreshold: 1,
		});

		if (commandHint) {
			return returnAutoCompletion(parsed, commandHint);
		}
	}

	return {hint: '', hints: [], overlap: 0, remainder: ''};
};

const returnAutoCompletion = (
	parsed: ParsedCommandLine,
	hints: string[],
): AutoCompletion => {
	const selectedHint = hints[0] ?? '';
	const hint = selectedHint ? selectedHint + ' ' : '';
	const input = `${parsed.lastWord} `;
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
