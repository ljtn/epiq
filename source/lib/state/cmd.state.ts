import {getHint} from '../command-line/auto-complete.utils.js';
import {CmdResult, CmdResults, getCmdMeta} from '../command-line/cmd-utils.js';

export const commandDelimiter = ' ';
export type CurrentCmdMeta = {
	modifier: string;
	command: string;
	hint: string;
	validationStatus: CmdResult;
};
export type CommandLineState = {
	value: string;
	commandHistory: string[];
	commandHistoryIndex: number;
	autoCompleteHint: string;
	cursorPosition: number;
	commandMeta: CurrentCmdMeta;
};

export let commandLineState: CommandLineState = {
	commandHistory: [],
	value: '',
	commandHistoryIndex: -1,
	autoCompleteHint: '',
	cursorPosition: 0,
	commandMeta: {
		command: '',
		modifier: '',
		hint: '',
		validationStatus: CmdResults.None,
	},
};

// ===== Subscriptions =====
type Listener = () => void;
const listeners = new Set<Listener>();

const notify = () => {
	for (const l of listeners) l();
};

export const subscribeCommandLineState = (listener: Listener) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

type SetStateCb = (old: CommandLineState) => CommandLineState;

// ===== Updates =====
const setState = (cb: SetStateCb) => {
	const next = cb(structuredClone(commandLineState));
	const isCursorAtEndOfLine = next.cursorPosition === next.value.length;
	next.commandMeta = getCmdMeta(next.value);
	next.autoCompleteHint = isCursorAtEndOfLine ? getHint(next.value) : '';
	commandLineState = next;
	notify();
};

export const moveCursorPosition = (position: number) => {
	setState(s => ({
		...s,
		cursorPosition: Math.max(
			0,
			Math.min(s.value.length, s.cursorPosition + position),
		),
	}));
};
export const moveCursorPositionOfWord = (direction: 'left' | 'right') => {
	setState(s => {
		const {value, cursorPosition} = s;

		let newPos = cursorPosition;

		if (direction === 'left') {
			// Move left over spaces
			while (newPos > 0 && value[newPos - 1] === ' ') {
				newPos--;
			}
			// Move left over word characters
			while (newPos > 0 && value[newPos - 1] !== ' ') {
				newPos--;
			}
		} else {
			// Move right over current word
			while (newPos < value.length && value[newPos] !== ' ') {
				newPos++;
			}
			// Move right over spaces
			while (newPos < value.length && value[newPos] === ' ') {
				newPos++;
			}
		}

		return {
			...s,
			cursorPosition: newPos,
		};
	});
};

export const eraseInput = () => {
	setState(s => {
		const remainingValue = s.value.slice(s.cursorPosition);
		const newCursorPos = Math.max(0, s.cursorPosition - 1);
		return {
			...s,
			value: s.value.slice(0, newCursorPos) + remainingValue,
			cursorPosition: newCursorPos,
		};
	});
};

export const eraseInputWord = () => {
	setState(s => {
		const {value, cursorPosition} = s;

		let newCursorPos = cursorPosition;

		// Move left over spaces
		while (newCursorPos > 0 && value[newCursorPos - 1] === ' ') {
			newCursorPos--;
		}
		// Move left over word characters
		while (newCursorPos > 0 && value[newCursorPos - 1] !== ' ') {
			newCursorPos--;
		}

		const remainingValue = value.slice(cursorPosition);
		return {
			...s,
			value: value.slice(0, newCursorPos) + remainingValue,
			cursorPosition: newCursorPos,
		};
	});
};

type SetCmdStateCallback = (previous: string, hint: string) => string;

export const setCmdInput = (cb: SetCmdStateCallback) => {
	setState(state => {
		const cursor = Math.max(
			0,
			Math.min(state.cursorPosition, state.value.length),
		);

		const before = state.value.slice(0, cursor);
		const after = state.value.slice(cursor);

		// Let cb operate on the text "to the left of the cursor"
		const newBefore = cb(before, state.autoCompleteHint);

		const nextValue = newBefore + after;

		// Cursor moves by the delta in "before" length
		const nextCursor = Math.max(
			0,
			Math.min(newBefore.length, nextValue.length),
		);

		return {
			...state,
			value: nextValue,
			cursorPosition: nextCursor,
		};
	});
};

export const updateCmdHistory = () => {
	setState(state => ({
		...state,
		commandHistory: [state.value, ...state.commandHistory].slice(0, 20),
	}));
};

export const getPrevCmd = () => {
	setState(s => {
		const nextIndex = Math.min(
			s.commandHistoryIndex + 1,
			s.commandHistory.length - 1,
		);
		const value = s.commandHistory[nextIndex] ?? '';
		return {
			...s,
			commandHistoryIndex: nextIndex,
			value,
			cursorPosition: value.length,
		};
	});
};

export const getNextCmd = () => {
	setState(s => {
		const nextIndex = Math.max(s.commandHistoryIndex - 1, -1);
		const value = nextIndex === -1 ? '' : s.commandHistory[nextIndex] ?? '';
		return {
			...s,
			commandHistoryIndex: nextIndex,
			value,
			cursorPosition: value.length,
		};
	});
};

export const clearCmd = () => setCmdInput(() => '');

export const getCmdState = () => commandLineState;

export const getCmdArg = () => {
	const [_, ...rest] = commandLineState.value.split(commandDelimiter);
	return rest.join(commandDelimiter);
};
