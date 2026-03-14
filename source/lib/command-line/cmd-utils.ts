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
	TagTicket: 'tag-ticket',
} as const;

export const CmdKeywords = {
	HELP: 'help',
	RENAME: 'rename',
	ADD: 'add',
	DELETE: 'delete',
	VIEW: 'view',
	TAG: 'tag',
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

export const CmdMeta: Record<
	CmdKeyword,
	{
		autoCompleteHints: string[];
		validateModifier: (
			cw: CmdKeyword,
			cm: DefaultCmdModifier | string,
		) => CmdResult;
	}
> = {
	[CmdKeywords.DELETE]: {
		autoCompleteHints: ['confirm'],
		validateModifier: (_command, modifier) =>
			CmdModifiers.Node.includes(modifier)
				? CmdResults.Succeed
				: CmdResults.Fail,
	},
	[CmdKeywords.RENAME]: {
		autoCompleteHints: [],
		validateModifier: (_command, _modifier) => CmdResults.None,
	},
	[CmdKeywords.ADD]: {
		autoCompleteHints: [],
		validateModifier: (_command, _modifier) => CmdResults.None,
	},
	[CmdKeywords.HELP]: {
		autoCompleteHints: [],
		validateModifier: (_command, _modifier) => CmdResults.None,
	},
	[CmdKeywords.VIEW]: {
		autoCompleteHints: ['dense', 'wide'],
		validateModifier: (_command, modifier) => {
			const success = modifier === 'dense' || modifier === 'wide';
			return success ? CmdResults.Succeed : CmdResults.Fail;
		},
	},
	[CmdKeywords.TAG]: {
		autoCompleteHints: Object.keys(TAGS_DEFAULT),
		validateModifier: (_command, modifier) => {
			const success = modifier === 'dense' || modifier === 'wide';
			return success ? CmdResults.Succeed : CmdResults.Fail;
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
		return {
			command: firstWord,
			modifier,
			autoCompleteHints: meta.autoCompleteHints,
			validationStatus: meta.validateModifier(
				firstWord as CmdKeyword,
				secondWord as DefaultCmdModifier,
			),
		};
	}
	return {
		validationStatus: CmdResults.None,
		autoCompleteHints: [''],
		command: firstWord ?? '',
		modifier,
	};
};
