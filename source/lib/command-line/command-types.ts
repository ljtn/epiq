export const CmdKeywords = {
	INIT: 'init',
	HELP: 'help',
	NEW: 'new',
	TAG: 'tag',
	FILTER: 'filter',
	MOVE: 'move',
	ASSIGN: 'assign',
	DELETE: 'delete',
	RENAME: 'rename',

	CLOSE_ISSUE: 'close',
	RE_OPEN_ISSUE: 'reopen',
	SET_DESCRIPTION: 'edit',

	SET_EDITOR: 'set:editor',
	SET_VIEW: 'set:view',
	SET_USERNAME: 'set:username',

	// Git
	SYNC: 'sync',

	NONE: '',
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

export type ReturnSuccess<T = undefined> = {
	result: typeof cmdResult.Success;
	message: string;
	data?: T;
};

export type ReturnFail = {
	result: CmdResult;
	message: string;
	data: null;
};

export const failed = (message: string): ReturnFail => ({
	result: cmdResult.Fail,
	message,
	data: null,
});

export const succeeded = <T = undefined>(
	message: string,
	data?: T,
): ReturnSuccess<T> => ({
	result: cmdResult.Success,
	message,
	data,
});

export const noResult = (): ReturnFail => ({
	result: cmdResult.None,
	message: 'No result',
	data: null,
});

export type Result<T = unknown> = ReturnSuccess<T> | ReturnFail;

export const isFail = <T>(res: Result<T>): res is ReturnFail =>
	res.result === 'fail';

export const isSuccess = <T>(res: Result<T>): res is ReturnSuccess<T> =>
	res.result === 'success';
