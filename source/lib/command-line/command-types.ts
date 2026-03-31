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

export type ReturnSuccess<T = unknown> = {
	result: CmdResult;
	message: string;
	data: T;
};
export type ReturnFail = {
	result: CmdResult;
	message: string;
	data: null;
};
export type ReturnedResult = ReturnSuccess | ReturnFail;

export const failed = (message: string): ReturnFail => ({
	result: cmdResult.Fail,
	message,
	data: null,
});

export const succeeded = <T>(message: string, data: T): ReturnSuccess<T> => ({
	result: cmdResult.Success,
	message,
	data,
});

export const noResult = (): ReturnFail => ({
	result: cmdResult.None,
	message: 'No result',
	data: null,
});

export type Result<T> = ReturnSuccess<T> | ReturnFail;

export const isFail = <T>(res: Result<T>): res is ReturnFail =>
	res.result === 'fail';

export const isSuccess = <T>(res: Result<T>): res is ReturnSuccess<T> =>
	res.result === 'success';
