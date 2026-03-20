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

export const cmdValidity = {
	None: 'none',
	Invalid: 'invalid',
	Valid: 'valid',
} as const;

export const cmdResult = {
	None: 'none',
	Success: 'success',
	Fail: 'fail',
} as const;

export type CmdKeyword = (typeof CmdKeywords)[keyof typeof CmdKeywords];
export type DefaultCmdModifier =
	(typeof CmdModifiers)[keyof typeof CmdModifiers];
export type CmdResult = (typeof cmdResult)[keyof typeof cmdResult];
export type CmdValidity = (typeof cmdValidity)[keyof typeof cmdValidity];

export type Result = {result: CmdResult; message?: string};
