import {useSyncExternalStore} from 'react';
import {failed, Result, succeeded} from '../model/result-types.js';
import {AppState} from '../model/app-state.model.js';

export type UiState = {
	pendingNavTarget?: {
		selectedIndex: AppState['selectedIndex'];
		contextNode: AppState['contextNode'];
		selectedNode: AppState['selectedNode'];
		breadCrumb: AppState['breadCrumb'];
	};
};

let _uiState: UiState | undefined;

const uiListeners = new Set<() => void>();

const emitUi = () => {
	for (const l of uiListeners) l();
};

const subscribeUi = (listener: () => void) => {
	uiListeners.add(listener);
	return () => uiListeners.delete(listener);
};

export const getUiState = () => {
	if (!_uiState) {
		throw new Error('Ui state not initialized. Call initUiState() first.');
	}

	return _uiState;
};

export const getSafeUiState = (): Result<UiState> => {
	if (!_uiState) {
		return failed('Ui state not initialized. Call initUiState() first.');
	}

	return succeeded('Retrieved Ui state', _uiState);
};

export const initUiState = (initialState: UiState = {}): Result<string> => {
	_uiState = initialState;
	emitUi();

	return succeeded('UX state initialized', null);
};

export const updateUiState = (
	cb: (old: UiState) => UiState,
): Result<string> => {
	const prev = getUiState();
	_uiState = cb(prev);

	emitUi();

	return succeeded('UX state updated', null);
};

export const patchUiState = (patch: Partial<UiState>): Result<string> =>
	updateUiState(old => ({
		...old,
		...patch,
	}));

export const resetUiState = (): Result<string> => {
	_uiState = {};
	emitUi();

	return succeeded('UX state reset', null);
};

export const isUiStateInitialized = () => _uiState !== undefined;

/** Ink/React hook */
export const useUiState = () =>
	useSyncExternalStore(subscribeUi, getUiState, getUiState);
