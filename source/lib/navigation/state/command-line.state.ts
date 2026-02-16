import {CmdKeywords} from '../command-line/command-line-sequence-intent.js';

export const commandDelimiter = ' ';

export type CommandLineState = {
	value: string;
	commandHistory: string[];
	commandHistoryIndex: number;
	autoCompleteHint: string;
};

export let commandLineState: CommandLineState = {
	commandHistory: [],
	value: '',
	commandHistoryIndex: -1,
	autoCompleteHint: '',
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

// ===== Updates =====
export const updateCommandLineState = (
	cb: (old: CommandLineState) => CommandLineState,
) => {
	const next = cb(structuredClone(commandLineState));
	commandLineState = next;
	notify();
};

const getAutoCompleteHint = (command: string) => {
	if (!command) return '';
	const hints = Object.values(CmdKeywords);
	const [hint] = hints.filter(x => x.startsWith(command));
	return hint || '';
};

export const updateCommandLineInput = (
	cb: (previous: string, hint: string) => string,
) => {
	updateCommandLineState(state => ({
		...state,
		value: cb(state.value, state.autoCompleteHint),
		autoCompleteHint: getAutoCompleteHint(
			cb(state.value, state.autoCompleteHint),
		),
	}));
};

export const updateCommandHistory = () => {
	updateCommandLineState(state => ({
		...state,
		commandHistory: [state.value, ...state.commandHistory].slice(0, 20),
	}));
};

export const getPrevCommand = () => {
	updateCommandLineState(s => {
		const nextIndex = Math.min(
			s.commandHistoryIndex + 1,
			s.commandHistory.length - 1,
		);
		return {
			...s,
			commandHistoryIndex: nextIndex,
			value: s.commandHistory[nextIndex] ?? '',
		};
	});
};

export const getNextCommand = () => {
	updateCommandLineState(s => {
		// typically you want to clamp down to -1 (meaning "no selection")
		const nextIndex = Math.max(s.commandHistoryIndex - 1, -1);
		return {
			...s,
			commandHistoryIndex: nextIndex,
			value: nextIndex === -1 ? '' : s.commandHistory[nextIndex] ?? '',
		};
	});
};

export const clearCommandLine = () => updateCommandLineInput(() => '');

export const getCommandLineInput = () => commandLineState.value;

export const getCommandLineArgumentValue = () => {
	const [_, ...rest] = commandLineState.value.split(commandDelimiter);
	return rest.join(commandDelimiter);
};
