import readline from 'readline';
import {ParsedCommandLine} from '../command-line/command-parser.js';
import {Result} from '../command-line/command-types.js';

export const Mode = {
	DEFAULT: 'default',
	MOVE: 'move',
	HELP: 'help',
	COMMAND_LINE: 'command-line',
} as const;
export type ModeUnion = (typeof Mode)[keyof typeof Mode];

export type ActionEntry = {
	intent?: string;
	mode: ModeUnion;
	description?: `[${string}] ${string}`;
	action: (...args: [ActionEntry, readline.Key]) => Result | void;
};

export type ActionMap<T extends Record<string, any[]>> = {
	[K in keyof T]: ActionEntry[];
};

type CommandLineInput = Pick<
	ParsedCommandLine,
	'command' | 'modifier' | 'inputString'
>;
export type CommandLineActionEntry = Omit<ActionEntry, 'action'> & {
	action: (...args: [CommandLineActionEntry, CommandLineInput]) => Result;
	onSuccess?: () => void;
};

export type ActionIndex = Partial<
	Record<ModeUnion, Partial<Record<string, ActionEntry>>>
>;
