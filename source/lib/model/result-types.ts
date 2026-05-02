import {logger} from '../../logger.js';
export const resultStatuses = {
	None: 'none',
	Success: 'success',
	Fail: 'fail',
} as const;
export type ResultStatus = (typeof resultStatuses)[keyof typeof resultStatuses];

export type ReturnSuccess<T = unknown> = {
	status: ResultStatus;
	message: string;
	value: T;
};
export type ReturnFail = {
	status: ResultStatus;
	message: string;
	value: null;
};

export const failed = (message: string): ReturnFail => {
	logger.error(message);
	return {
		status: resultStatuses.Fail,
		message,
		value: null,
	};
};

export const succeeded = <T>(message: string, value: T): ReturnSuccess<T> => {
	logger.info(message);
	return {
		status: resultStatuses.Success,
		message,
		value,
	};
};

export type Result<T = unknown> = ReturnSuccess<T> | ReturnFail;

export const isFail = <T>(res: Result<T>): res is ReturnFail =>
	res.status === 'fail';

export const isSuccess = <T>(res: Result<T>): res is ReturnSuccess<T> =>
	res.status === 'success';
