import {CurrentCmdMeta} from '../state/cmd.state.js';
import {getAutoCompletion} from './command-auto-complete.js';
import {getCmdModifiers} from './command-modifiers.js';
import {ParsedCommandLine} from './command-parser.js';
import {CmdKeyword} from './cmd-keywords.js';
import {CmdKeywords} from './cmd-keywords.js';
import {cmdValidation} from './command-validation.js';
import {DEFAULT_WORDS} from './default-word-list.js';

export const CmdIntent = {
	// Fundamentals (tight coupling to scope)
	Init: 'init',
	None: 'none',
	ViewHelp: 'view-help',
	Rename: 'rename',
	Edit: 'edit',
	Delete: 'delete',

	Filter: 'filter',
	Move: 'move',
	Peek: 'peek',

	// Settings
	SetView: 'set-view',
	SetEditor: 'set-editor',
	SetUserName: 'set-user-name',
	SetAutoSync: 'set-auto-sync',

	// Add
	NewItem: 'add-new-item',

	TagTicket: 'ticket-tag',
	UntagTicket: 'ticket-untag',
	AssignUserToTicket: 'ticket-assign-user',
	UnassignUserFromTicket: 'ticket-unassign-user',
	CloseIssue: 'close-issue',
	ReopenIssue: 're-open-issue',

	// Git
	Sync: 'sync',
} as const;

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
