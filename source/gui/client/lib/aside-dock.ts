import {useState} from 'react';

/**
 * Which edge the detail panel is attached to.
 *
 * This lives outside `Aside` because the flex row that holds the board and the
 * panel has to turn into a column for a bottom dock, and a component cannot
 * style its own parent. `App` owns the state and hands it down; `Aside` only
 * reads it.
 */
export type AsideDock = 'right' | 'bottom';

const DOCK_STORAGE_KEY = 'epiq.aside.dock';

export const readStoredAsideDock = (): AsideDock =>
	localStorage.getItem(DOCK_STORAGE_KEY) === 'bottom' ? 'bottom' : 'right';

// Read synchronously in the initializer, like the panel's width: the lanes
// layout is decided on the first render, and an effect would let a frame
// through with the panel docked one way and its contents laid out the other.
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
