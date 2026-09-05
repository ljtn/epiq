import {useState} from 'react';

// Only an explicit stored value overrides the fallback, so a series that
// defaults to on stays on until somebody turns it off.
export const usePersistedFlag = (
	key: string,
	fallback: boolean,
): [boolean, (next: boolean) => void] => {
	const [value, setValue] = useState(() => {
		const stored = localStorage.getItem(key);
		return stored === null ? fallback : stored === 'true';
	});

	return [
		value,
		(next: boolean) => {
			setValue(next);
			localStorage.setItem(key, String(next));
		},
	];
};
