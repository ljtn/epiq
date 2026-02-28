import readline from 'readline';
import {appState} from './state/state.js';
import {getKeyIntent} from './utils/key-intent.js';
import {navigator} from '../actions/default/navigation-action-utils.js';

let currentKeypressListener: ((s: string, k: readline.Key) => void) | undefined;

const getKeyPressListener = () => {
	return async function onKeyPress(_: string, key: readline.Key) {
		if (key.ctrl && key.name === 'c') return navigator.exit();

		const filteredActions = appState.availableActions.filter(
			a => a.mode === appState.mode,
		);

		const actionMeta = filteredActions.find(
			({intent, mode}) => getKeyIntent(key, mode) === intent,
		);

		if (!actionMeta?.action) return;

		try {
			const res = actionMeta.action(navigator, actionMeta, key);
			if (res instanceof Promise) await res;
		} catch (err) {
			logger.error(err);
		}
	};
};

export function initListeners() {
	if (currentKeypressListener) {
		process.stdin.removeListener('keypress', currentKeypressListener);
	}

	currentKeypressListener = getKeyPressListener();

	readline.emitKeypressEvents(process.stdin);
	if (process.stdin.isTTY) process.stdin.setRawMode(true);
	process.stdin.on('keypress', currentKeypressListener);
}
