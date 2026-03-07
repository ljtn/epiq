import {CurrentCmdMeta} from '../state/cmd.state.js';

export const CmdIntent = {
	None: 'none',
	AddBoard: 'add-board',
	AddSwimlane: 'add-swimlane',
	AddTicket: 'add-ticket',
	AddListItem: 'add-list-item',
	ViewHelp: 'view-help',
	Rename: 'rename',
	Delete: 'delete',
	SetView: 'set-view',
} as const;

export const CmdKeywords = {
	HELP: 'help',
	RENAME: 'rename',
	ADD: 'add',
	DELETE: 'delete',
	VIEW: 'view',
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

export const isCmdKeyword = (word: CmdKeyword): boolean =>
	Object.values(CmdKeywords).includes(word);

export type CmdKeyword = (typeof CmdKeywords)[keyof typeof CmdKeywords];
export type DefaultCmdModifier =
	(typeof CmdModifiers)[keyof typeof CmdModifiers];
export type CmdResult = (typeof CmdResults)[keyof typeof CmdResults];

export const CmdMeta: Record<
	CmdKeyword,
	{
		hint: string;
		validateModifier: (
			cw: CmdKeyword,
			cm: DefaultCmdModifier | string,
		) => CmdResult;
	}
> = {
	[CmdKeywords.DELETE]: {
		hint: `node`,
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
	[CmdKeywords.VIEW]: {
		hint: `'dense' or 'wide'`,
		validateModifier: (_command, modifier) => {
			const success = modifier === 'dense' || modifier === 'wide';
			logger.info('success', success);
			return success ? CmdResults.Succeed : CmdResults.Fail;
		},
	},
} as const;

export const getCmdMeta = (value: string): CurrentCmdMeta => {
	const words = value.split(' ');
	const [firstWord, ...rest] = words;
	const [secondWord] = rest;
	const firstWordIsCmdKeyword = isCmdKeyword(words[0] as CmdKeyword);

	const modifier = rest.join?.(' ') ?? '';
	if (firstWord && firstWordIsCmdKeyword) {
		const meta = CmdMeta[firstWord as CmdKeyword];
		return {
			command: firstWord,
			modifier,
			hint: meta.hint,
			validationStatus: meta.validateModifier(
				firstWord as CmdKeyword,
				secondWord as DefaultCmdModifier,
			),
		};
	}
	return {
		validationStatus: CmdResults.None,
		hint: '',
		command: firstWord ?? '',
		modifier,
	};
};
