import readline from 'readline';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import {Mode} from '../model/action-map.model.js';
import {getState} from '../state/state.js';
import {getKeyIntent, IntentInferred, Intent} from '../utils/key-intent.js';

let currentKeypressListener: ((s: string, k: readline.Key) => void) | undefined;
let currentDataListener: ((chunk: Buffer) => void) | undefined;
let escTimer: NodeJS.Timeout | undefined;

const AVAILABLE_IN_READ_ONLY = new Set<IntentInferred>([
	Intent.MoveCursorLeft,
	Intent.EraseInputWord,
	Intent.MoveCursorLeftOfWord,
	Intent.MoveCursorRight,
	Intent.MoveCursorRightOfWord,
	Intent.NavToPreviousContainer,
	Intent.NavToNextContainer,
	Intent.NavPreviousItem,
	Intent.NavNextItem,
	Intent.SetViewDense,
	Intent.SetViewWide,
	Intent.Confirm,
	Intent.Exit,
	Intent.Yank,
	Intent.InitCommandLine,
	Intent.InitCommandPalette,
	Intent.ExitCommandLine,
	Intent.CaptureInput,
	Intent.EraseInput,
	Intent.EraseInputWord,
	Intent.HideHelp,
	Intent.ViewHelp,
	Intent.SetViewDense,
	Intent.SetViewWide,
	Intent.GetLastCommandFromHistory,
	Intent.GetNextCommandFromHistory,
	Intent.AutoCompleteCommand,
]);

// Disabled while a replay is playing so the board stays a locked "cinema" view
const REPLAY_BLOCKED_INTENTS = new Set<IntentInferred>([
	Intent.NavPreviousItem,
	Intent.NavNextItem,
	Intent.NavToPreviousContainer,
	Intent.NavToNextContainer,
	Intent.Confirm,
	Intent.Exit,
	Intent.InitCommandPalette,
	Intent.InitMove,
	Intent.MoveNextItem,
	Intent.MovePreviousItem,
	Intent.MoveToNextContainer,
	Intent.MoveToPreviousContainer,
	Intent.Delete,
	Intent.AddItem,
	Intent.EditTitle,
	Intent.EditDescription,
	Intent.ConfirmMove,
	Intent.Edit,
	Intent.ViewHelp,
	Intent.Yank,
]);

const triggerAction = async (key: readline.Key) => {
	if (key.ctrl && key.name === 'c') {
		return navigationUtils.exit();
	}

	const {actionIndex, mode, readOnly, timeMode} = getState();
	const intent = getKeyIntent(key, mode);
	if (!intent) return;

	if (readOnly && !AVAILABLE_IN_READ_ONLY.has(intent)) {
		return;
	}

	if (
		timeMode === 'replay' &&
		mode === Mode.DEFAULT &&
		REPLAY_BLOCKED_INTENTS.has(intent)
	) {
		return;
	}

	const actionMeta = actionIndex[mode]?.[intent];
	if (!actionMeta?.action) return;

	try {
		await actionMeta.action(actionMeta, key);
	} catch (err) {
		logger.error(err);
	}
};

const getKeyPressListener = () => {
	return async function onKeyPress(_: string, key: readline.Key) {
		// Ignore the delayed escape from readline if we already handled it ourselves
		if (key.name === 'escape') {
			return;
		}

		if (escTimer) {
			clearTimeout(escTimer);
			escTimer = undefined;
		}

		await triggerAction(key);
	};
};

const getDataListener = () => {
	return async function onData(chunk: Buffer) {
		// Lone ESC byte
		if (chunk.length === 1 && chunk[0] === 0x1b) {
			if (escTimer) clearTimeout(escTimer);

			// Small delay so arrow keys / alt combos can still arrive as sequences
			escTimer = setTimeout(() => {
				void triggerAction({
					name: 'escape',
					ctrl: false,
					meta: false,
					shift: false,
					sequence: '\u001b',
				} as readline.Key);
				escTimer = undefined;
			}, 25);

			return;
		}

		// If more bytes arrived, this was not a lone ESC
		if (escTimer) {
			clearTimeout(escTimer);
			escTimer = undefined;
		}
	};
};

export function initListeners() {
	if (currentKeypressListener) {
		process.stdin.removeListener('keypress', currentKeypressListener);
	}
	if (currentDataListener) {
		process.stdin.removeListener('data', currentDataListener);
	}

	currentKeypressListener = getKeyPressListener();
	currentDataListener = getDataListener();

	readline.emitKeypressEvents(process.stdin);

	if (process.stdin.isTTY) {
		process.stdin.setRawMode(true);
	}

	process.stdin.on('data', currentDataListener);
	process.stdin.on('keypress', currentKeypressListener);
}
