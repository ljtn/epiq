export const CmdKeywords = {
	HELP: 'help',
	RENAME: 'rename',
	NEW: 'new',
	DELETE: 'delete',
	VIEW: 'view',
	TAG: 'tag',
	ASSIGN: 'assign',
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
export type CmdResult = (typeof cmdResult)[keyof typeof cmdResult];
export type CmdValidity = (typeof cmdValidity)[keyof typeof cmdValidity];

export type Result = {result: CmdResult; message?: string};
