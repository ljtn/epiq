import readline from 'readline';
import {navigator} from '../actions/default/navigation-action-utils.js';
import {getState} from '../state/state.js';
import {getKeyIntent} from '../utils/key-intent.js';

let currentKeypressListener: ((s: string, k: readline.Key) => void) | undefined;

const getKeyPressListener = () => {
	return async function onKeyPress(_: string, key: readline.Key) {
		if (key.ctrl && key.name === 'c') {
			return navigator.exit();
		}

		const {availableActions, mode} = getState();
		const intent = getKeyIntent(key, mode);

		const actionMeta = availableActions.find(
			a => a.mode === mode && a.intent === intent,
		);

		if (!actionMeta?.action) {
			return;
		}

		try {
			await actionMeta.action(navigator, actionMeta, key);
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
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(true);
	}

	process.stdin.on('keypress', currentKeypressListener);
}
