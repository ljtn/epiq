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

export type CmdKeyword = (typeof CmdKeywords)[keyof typeof CmdKeywords];
export type DefaultCmdModifier =
	(typeof CmdModifiers)[keyof typeof CmdModifiers];
export type CmdResult = (typeof CmdResults)[keyof typeof CmdResults];

export type Result = {result: CmdResult; message?: string};
