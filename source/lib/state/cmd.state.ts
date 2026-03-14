import {getHint} from '../command-line/auto-complete.utils.js';
import {
	CmdResult,
	CmdResults,
	getCmdMeta,
	Result,
} from '../command-line/cmd-utils.js';

export const commandDelimiter = ' ';
export type CurrentCmdMeta = {
	modifier: string;
	command: string;
	infoHint: string;
	autoCompleteHints: string[];
	validationStatus: CmdResult;
};
export type CommandLineState = {
	value: string;
	commandHistory: string[];
	commandHistoryIndex: number;
	autoCompleteHint: string;
	cursorPosition: number;
	commandIsPending: boolean;
	commandMeta: CurrentCmdMeta;
};

export let commandLineState: CommandLineState = {
	commandHistory: [],
	value: '',
	commandHistoryIndex: -1,
	autoCompleteHint: '',
	cursorPosition: 0,
	commandIsPending: false,
	commandMeta: {
		command: '',
		modifier: '',
		infoHint: '',
		autoCompleteHints: [''],
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

export const overrideValidationResult = ({hint, result}: Result) => {
	const next = structuredClone(commandLineState);
	next.commandMeta = {
		...next.commandMeta,
		infoHint: hint ?? '',
		validationStatus: result,
	};
	next.commandIsPending = true;
	commandLineState = next;
	logger.info(next);
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
			while (newPos > 0 && value[newPos - 1] === ' ') {
				newPos--;
			}
			while (newPos > 0 && value[newPos - 1] !== ' ') {
				newPos--;
			}
		} else {
			while (newPos < value.length && value[newPos] !== ' ') {
				newPos++;
			}
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
			commandIsPending: false,
		};
	});
};

export const eraseInputWord = () => {
	setState(s => {
		const {value, cursorPosition} = s;

		let newCursorPos = cursorPosition;

		while (newCursorPos > 0 && value[newCursorPos - 1] === ' ') {
			newCursorPos--;
		}
		while (newCursorPos > 0 && value[newCursorPos - 1] !== ' ') {
			newCursorPos--;
		}

		const remainingValue = value.slice(cursorPosition);
		return {
			...s,
			value: value.slice(0, newCursorPos) + remainingValue,
			cursorPosition: newCursorPos,
			commandIsPending: false,
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
		const newBefore = cb(before, state.autoCompleteHint);
		const nextValue = newBefore + after;
		const nextCursor = Math.max(
			0,
			Math.min(newBefore.length, nextValue.length),
		);

		return {
			...state,
			value: nextValue,
			cursorPosition: nextCursor,
			commandIsPending: false,
		};
	});
};

export const commandPending = () => {
	setState(state => ({
		...state,
		commandIsPending: true,
	}));
};
export const commandConfirmed = () => {
	setState(state => ({
		...state,
		commandHistory: [state.value, ...state.commandHistory].slice(0, 20),
		commandHistoryIndex: -1,
		commandIsPending: false,
	}));
	clearCmd();
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
	return rest.join(commandDelimiter).trim();
};

export const isInvalidCommand = (): boolean => {
	const {commandMeta} = getCmdState();
	return commandMeta.validationStatus === CmdResults.Fail;
};
