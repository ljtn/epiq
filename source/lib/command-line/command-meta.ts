import {CurrentCmdMeta} from '../state/cmd.state.js';
import {getAutoCompletion} from './command-auto-complete.js';
import {getCmdModifiers} from './command-modifiers.js';
import {ParsedCommandLine} from './command-parser.js';
import {CmdKeyword, CmdKeywords} from './command-types.js';
import {cmdValidation} from './command-validation.js';
import {DEFAULT_WORDS} from './default-word-list.js';

export const CmdIntent = {
	// Fundamentals (tight coupling to scope)
	None: 'none',
	ViewHelp: 'view-help',
	Rename: 'rename',
	Delete: 'delete',

	Filter: 'filter',

	// Settings
	SetView: 'set-view',
	SetEditor: 'set-editor',
	SetUserName: 'set-user-name',

	// Add
	NewItem: 'add-new-item',

	TagTicket: 'ticket-tag',
	AssignUserToTicket: 'ticket-assign-user',
	CloseIssue: 'close-issue',
	ReopenIssue: 're-open-issue',
} as const;

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
	const {message, validity, completionWordList} = cmdValidation[
		command
	].validate(command, modifier, inputString);

	const wordList =
		target === 'command'
			? Object.values(CmdKeywords)
			: command && parsed.target === 'modifier'
			? getCmdModifiers(command)
			: DEFAULT_WORDS;

	return {
		validity,
		command: parsed.command,
		modifier: parsed.modifier,
		inputString: parsed.inputString,
		infoMessage: message ?? '',
		autoCompletion: isCursorAtEndOfLine
			? getAutoCompletion(parsed, [...completionWordList, ...wordList])
			: {hint: '', hints: [], remainder: '', overlap: 0},
	};
};
