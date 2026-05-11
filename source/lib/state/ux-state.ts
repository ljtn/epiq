import {useSyncExternalStore} from 'react';
import {failed, Result, succeeded} from '../model/result-types.js';

// export type UxState = {
// 	pendingNavTarget: {selectedIndex: number, currentNode}
// };

let _uxState: UxState | undefined;

const uxListeners = new Set<() => void>();

const emitUx = () => {
	for (const l of uxListeners) l();
};

const subscribeUx = (listener: () => void) => {
	uxListeners.add(listener);
	return () => uxListeners.delete(listener);
};

export const getUxState = () => {
	if (!_uxState) {
		throw new Error('UX state not initialized. Call initUxState() first.');
	}

	return _uxState;
};

export const getSafeUxState = (): Result<UxState> => {
	if (!_uxState) {
		return failed('UX state not initialized. Call initUxState() first.');
	}

	return succeeded('Retrieved UX state', _uxState);
};

export const initUxState = (initialState: UxState = {}): Result<string> => {
	_uxState = initialState;
	emitUx();

	return succeeded('UX state initialized', null);
};

export const updateUxState = (
	cb: (old: UxState) => UxState,
): Result<string> => {
	const prev = getUxState();
	_uxState = cb(prev);

	emitUx();

	return succeeded('UX state updated', null);
};

export const patchUxState = (patch: Partial<UxState>): Result<string> =>
	updateUxState(old => ({
		...old,
		...patch,
	}));

export const resetUxState = (): Result<string> => {
	_uxState = {};
	emitUx();

	return succeeded('UX state reset', null);
};

export const isUxStateInitialized = () => _uxState !== undefined;

/** Ink/React hook */
export const useUxState = () =>
	useSyncExternalStore(subscribeUx, getUxState, getUxState);
