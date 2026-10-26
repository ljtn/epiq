import {useState} from 'react';

/**
 * Which edge the detail panel is attached to. Owned by `App`, since a bottom
 * dock turns the parent flex row into a column.
 */
export type AsideDock = 'right' | 'bottom';

const DOCK_STORAGE_KEY = 'epiq.aside.dock';

export const readStoredAsideDock = (): AsideDock =>
	localStorage.getItem(DOCK_STORAGE_KEY) === 'bottom' ? 'bottom' : 'right';

// Read synchronously: an effect would let one frame through docked the wrong way.
export const useAsideDock = (): [AsideDock, (next: AsideDock) => void] => {
	const [dock, setDock] = useState(readStoredAsideDock);

	return [
		dock,
		(next: AsideDock) => {
			setDock(next);
			localStorage.setItem(DOCK_STORAGE_KEY, next);
		},
	];
};
