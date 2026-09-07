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

// The same store, for one choice out of a fixed set rather than a flag, with
// null for "none of them". A stored value the set no longer holds reads as
// null, so a renamed option cannot leave a control stuck on something it has
// stopped offering.
export const usePersistedChoice = <T extends string>(
	key: string,
	isValid: (value: string) => value is T,
): [T | null, (next: T | null) => void] => {
	const [value, setValue] = useState<T | null>(() => {
		const stored = localStorage.getItem(key);
		return stored !== null && isValid(stored) ? stored : null;
	});

	return [
		value,
		(next: T | null) => {
			setValue(next);
			localStorage.setItem(key, next ?? '');
		},
	];
};
