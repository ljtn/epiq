import {isFail, Result} from '../model/result-types.js';

type MemoizedResultFn<F extends (...args: any[]) => Promise<Result<any>>> = {
	(...args: Parameters<F>): ReturnType<F>;
	clear: () => void;
};

export const memoizeResult = <
	F extends (...args: any[]) => Promise<Result<any>>,
>(
	fn: F,
	getKey?: (...args: Parameters<F>) => string,
): MemoizedResultFn<F> => {
	const cache = new Map<string, ReturnType<F>>();

	const resolveKey =
		getKey ?? ((...args: Parameters<F>): string => JSON.stringify(args));

	const wrapped = ((...args: Parameters<F>): ReturnType<F> => {
		const key = resolveKey(...args);

		if (!cache.has(key)) {
			const promise = fn(...args).then(result => {
				if (isFail(result)) {
					cache.delete(key);
				}
				return result;
			}) as ReturnType<F>;

			cache.set(key, promise);
		}

		return cache.get(key)!;
	}) as MemoizedResultFn<F>;

	wrapped.clear = () => cache.clear();

	return wrapped;
};
