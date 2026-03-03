export function deepFreeze<T>(obj: T): T {
	if (obj && typeof obj === 'object') {
		Object.freeze(obj);
		for (const key of Object.keys(obj)) {
			// @ts-ignore
			deepFreeze(obj[key]);
		}
	}
	return obj;
}
