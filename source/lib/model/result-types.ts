export const resultStatuses = {
	None: 'none',
	Success: 'success',
	Fail: 'fail',
} as const;
export type ResultStatus = (typeof resultStatuses)[keyof typeof resultStatuses];

export type ReturnSuccess<T = unknown> = {
	status: ResultStatus;
	message: string;
	data: T;
};
export type ReturnFail = {
	status: ResultStatus;
	message: string;
	data: null;
};

export const failed = (message: string): ReturnFail => ({
	status: resultStatuses.Fail,
	message,
	data: null,
});

export const succeeded = <T>(message: string, data: T): ReturnSuccess<T> => ({
	status: resultStatuses.Success,
	message,
	data,
});

export type Result<T = unknown> = ReturnSuccess<T> | ReturnFail;

export const isFail = <T>(res: Result<T>): res is ReturnFail =>
	res.status === 'fail';

export const isSuccess = <T>(res: Result<T>): res is ReturnSuccess<T> =>
	res.status === 'success';
