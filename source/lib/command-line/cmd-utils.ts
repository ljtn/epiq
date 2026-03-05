import {CurrentCmdMeta} from '../state/cmd.state.js';

export const CmdIntent = {
	None: 'none',
	AddBoard: 'add-board',
	AddSwimlane: 'add-swimlane',
	AddTicket: 'add-ticket',
	ViewHelp: 'view-help',
	Rename: 'rename',
	Delete: 'delete',
} as const;

export const CmdKeywords = {
	HELP: 'help',
	RENAME: 'rename',
	ADD: 'add',
	DELETE: 'delete',
} as const;
export type CmdKeyword = (typeof CmdKeywords)[keyof typeof CmdKeywords];

export const isCmdKeyword = (word: CmdKeyword): boolean =>
	Object.values(CmdKeywords).includes(word);

export const CmdModifiers = {
	None: 'none',
	All: 'all',
	Node: 'node',
} as const;
export type CmdModifier = (typeof CmdModifiers)[keyof typeof CmdModifiers];

export const CmdResults = {
	None: 'none',
	Fail: 'fail',
	Succeed: 'succeed',
} as const;
export type CmdResult = (typeof CmdResults)[keyof typeof CmdResults];

export const CmdMeta: Record<
	CmdKeyword,
	{
		hint: string;
		validateModifier: (cw: CmdKeyword, cm: CmdModifier) => CmdResult;
	}
> = {
	[CmdKeywords.DELETE]: {
		hint: `'node'`,
		validateModifier: (_command, modifier) =>
			modifier === CmdModifiers.Node ? CmdResults.Succeed : CmdResults.Fail,
	},
	[CmdKeywords.RENAME]: {
		hint: `enter new name of current node`,
		validateModifier: (_command, _modifier) => CmdResults.None,
	},
	[CmdKeywords.ADD]: {
		hint: `enter name of the new node`,
		validateModifier: (_command, _modifier) => CmdResults.None,
	},
	[CmdKeywords.HELP]: {
		hint: ``,
		validateModifier: (_command, _modifier) => CmdResults.None,
	},
} as const;

export const getCmdMeta = (value: string): CurrentCmdMeta => {
	const words = value.split(' ');
	const [firstWord, secondWord] = words;
	const firstWordIsCmdKeyword = isCmdKeyword(words[0] as CmdKeyword);

	if (firstWord && firstWordIsCmdKeyword) {
		const meta = CmdMeta[firstWord as CmdKeyword];
		return {
			hint: meta.hint,
			validationStatus: meta.validateModifier(
				firstWord as CmdKeyword,
				secondWord as CmdModifier,
			),
		};
	}
	return {validationStatus: CmdResults.None, hint: ''};
};
