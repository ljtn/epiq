import {CurrentCmdMeta} from '../state/cmd.state.js';
import {getAutoCompletion} from './command-auto-complete.js';
import {getCmdModifiers} from './command-modifiers.js';
import {ParsedCommandLine} from './command-parser.js';
import {CmdKeyword} from './cmd-keywords.js';
import {CmdKeywords} from './cmd-keywords.js';
import {cmdValidation} from './command-validation.js';
import {getVocabulary} from './corpus-vocabulary.js';
import {CmdIntent} from './command-intent.js';
import {getState} from '../state/state.js';
import {Mode} from '../model/action-map.model.js';

export type CommandIntent = (typeof CmdIntent)[keyof typeof CmdIntent];

export const isModifierKeyword = (word: string): word is CmdKeyword =>
	Object.values(CmdKeywords).includes(word as CmdKeyword);

export const isCmdKeyword = (word: string): word is CmdKeyword =>
	Object.values(CmdKeywords).includes(word as CmdKeyword);

export const getCmdMeta = (
	parsed: ParsedCommandLine,
	isCursorAtEndOfLine: boolean,
): CurrentCmdMeta => {
	const command = parsed.command ?? '';
	const {modifier, target, inputString} = parsed;
	const {
		message,
		validity,
		completionWordList: contextualWordList,
	} = cmdValidation[command].validate(command, modifier, inputString);

	const staticWordList =
		target === 'command' || target === 'modifier'
			? getCmdModifiers(command)
			: getVocabulary();

	const {mode} = getState();
	const hintMessage = mode === Mode.COMMAND_LINE ? message ?? '' : '';
	const autoCompletionWordList = [...contextualWordList, ...staticWordList];
	return {
		validity,
		command: parsed.command,
		modifier: parsed.modifier,
		inputString: parsed.inputString,
		infoMessage: hintMessage,
		autoCompletion: isCursorAtEndOfLine
			? getAutoCompletion(parsed, autoCompletionWordList)
			: {hint: '', hints: [], remainder: '', overlap: 0},
	};
};
