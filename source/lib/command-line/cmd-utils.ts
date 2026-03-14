import {settings} from '../settings/settings.js';
import {CurrentCmdMeta} from '../state/cmd.state.js';
import {TAGS_DEFAULT} from '../static/default-tags.js';

export const CmdIntent = {
	// Fundamentals (tight coupling to scope)
	None: 'none',
	AddBoard: 'add-board',
	AddSwimlane: 'add-swimlane',
	AddTicket: 'add-ticket',
	AddListItem: 'add-list-item',
	ViewHelp: 'view-help',
	Rename: 'rename',
	Delete: 'delete',
	SetView: 'set-view',

	// Higher order
	TagTicket: 'ticket-tag',
	AssignUserToTicket: 'ticket-assign-user',
} as const;

export const CmdKeywords = {
	HELP: 'help',
	RENAME: 'rename',
	ADD: 'add',
	DELETE: 'delete',
	VIEW: 'view',
	TAG: 'tag',
	ASSIGN: 'assign',
} as const;

export const CmdModifiers = {
	None: 'none',
	All: 'all',
	Node: 'node',
} as const;

export const CmdResults = {
	None: 'none',
	Fail: 'fail',
	Succeed: 'succeed',
} as const;

export const isCmdKeyword = (word: string): word is CmdKeyword =>
	Object.values(CmdKeywords).includes(word as CmdKeyword);

export type CmdKeyword = (typeof CmdKeywords)[keyof typeof CmdKeywords];
export type DefaultCmdModifier =
	(typeof CmdModifiers)[keyof typeof CmdModifiers];
export type CmdResult = (typeof CmdResults)[keyof typeof CmdResults];

export type Result = {result: CmdResult; hint?: string};

export const CmdMeta: Record<
	CmdKeyword,
	{
		autoCompleteHints: string[];
		validateCmd: (cw: CmdKeyword, cm: DefaultCmdModifier | string) => Result;
	}
> = {
	[CmdKeywords.DELETE]: {
		autoCompleteHints: ['confirm'],
		validateCmd: (_command, modifier) => ({
			result: CmdModifiers.Node.includes(modifier)
				? CmdResults.Succeed
				: CmdResults.Fail,
		}),
	},
	[CmdKeywords.RENAME]: {
		autoCompleteHints: [],
		validateCmd: (_command, _modifier) => ({result: CmdResults.Succeed}),
	},
	[CmdKeywords.ADD]: {
		autoCompleteHints: [],
		validateCmd: (_command, _modifier) => ({result: CmdResults.Succeed}),
	},
	[CmdKeywords.HELP]: {
		autoCompleteHints: [],
		validateCmd: (_command, _modifier) => ({result: CmdResults.Succeed}),
	},
	[CmdKeywords.VIEW]: {
		autoCompleteHints: ['dense', 'wide'],
		validateCmd: (_command, modifier) => {
			const success = modifier === 'dense' || modifier === 'wide';
			return {result: success ? CmdResults.Succeed : CmdResults.Fail};
		},
	},
	[CmdKeywords.TAG]: {
		autoCompleteHints: Object.keys(TAGS_DEFAULT),
		validateCmd: _command => {
			return {result: CmdResults.Succeed};
		},
	},
	[CmdKeywords.ASSIGN]: {
		autoCompleteHints: settings.users,
		validateCmd: (_command, modifier) => {
			const success = settings.users.includes(modifier);
			return {
				result: success ? CmdResults.Succeed : CmdResults.Fail,
				hint: !success ? 'Must be existing user name' : '',
			};
		},
	},
} as const;

export const getCmdMeta = (value: string): CurrentCmdMeta => {
	const words = value.split(' ');
	const [firstWord, ...rest] = words;
	const [secondWord] = rest;
	const firstWordIsCmdKeyword = isCmdKeyword(words[0] as CmdKeyword);

	const modifier = (rest.join?.(' ') ?? '').trim();
	if (firstWord && firstWordIsCmdKeyword) {
		const meta = CmdMeta[firstWord as CmdKeyword];
		const validation = meta.validateCmd(
			firstWord as CmdKeyword,
			secondWord as DefaultCmdModifier,
		);
		return {
			command: firstWord,
			modifier,
			autoCompleteHints: meta.autoCompleteHints,
			infoHint: validation.hint ?? '',
			validationStatus: validation.result,
		};
	}
	return {
		validationStatus: CmdResults.None,
		infoHint: '',
		autoCompleteHints: [''],
		command: firstWord ?? '',
		modifier,
	};
};
