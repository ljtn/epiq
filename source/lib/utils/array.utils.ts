export const filterMap = <T, R>(
	arr: T[],
	fn: (value: T, index: number) => R | null | undefined,
): R[] =>
	arr.reduce<R[]>((acc, value, index) => {
		const result = fn(value, index);
		if (result != null) acc.push(result);
		return acc;
	}, []);
