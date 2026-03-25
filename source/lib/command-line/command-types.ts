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

export type ReturnedSuccess<T = unknown> = {
	result: CmdResult;
	message: string;
	data: T;
};
export type ReturnedNoSuccess = {
	result: CmdResult;
	message: string;
	data: null;
};
export type ReturnedResult = ReturnedSuccess | ReturnedNoSuccess;

export const failed = (message: string): ReturnedNoSuccess => ({
	result: cmdResult.Fail,
	message,
	data: null,
});

export const succeeded = <T>(
	message: string,
	data?: T,
): ReturnedSuccess<T | null> => ({
	result: cmdResult.Success,
	message,
	data: data ?? null,
});

export const noResult = (): ReturnedNoSuccess => ({
	result: cmdResult.None,
	message: 'No result',
	data: null,
});
