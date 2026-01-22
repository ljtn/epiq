export const commandDelimiter = ' ';
export type CommandLineState = {
	value: string;
	commandHistory: string[];
	commandHistoryIndex: number;
};

export let commandLineState: CommandLineState = {
	commandHistory: [],
	value: '',
	commandHistoryIndex: -1,
};

export const updateCommandLineState = (
	cb: (old: CommandLineState) => CommandLineState,
) => {
	commandLineState = cb(structuredClone(commandLineState));
};

export const updateCommandLineInput = (cb: (previous: string) => string) => {
	updateCommandLineState(state => ({
		...state,
		value: cb(state.value),
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
		const nextIndex = Math.min(
			s.commandHistoryIndex - 1,
			s.commandHistory.length - 1,
		);
		return {
			...s,
			commandHistoryIndex: nextIndex,
			value: s.commandHistory[nextIndex] ?? '',
		};
	});
};

export const clearCommandLine = () => updateCommandLineInput(() => '');

export const getCommandLineInput = () => commandLineState.value;

export const getCommandLineArgumentValue = () => {
	const [_, ...rest] = commandLineState.value.split(commandDelimiter);
	const value = rest.join(commandDelimiter);
	bug(value);
	return value;
};
