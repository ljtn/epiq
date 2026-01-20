import {NavigateCtx} from './navigation-ctx.model.js';
import readline from 'readline';

export const Mode = {
	DEFAULT: 'default',
	MOVE: 'move',
	HELP: 'help',
	COMMAND_LINE: 'command-line',
} as const;
export type ModeUnion = (typeof Mode)[keyof typeof Mode];

export type ActionEntry = {
	intent?: string;
	mode: ModeUnion | ModeUnion[];
	description?: `[${string}] ${string}`;
	action?: (
		...args: [NavigateCtx, ActionEntry, readline.Key]
	) => void | Promise<void>;
};

export type ActionMap<T extends Record<string, any[]>> = {
	[K in keyof T]: ActionEntry[];
};

// Command Line
type CommandLineInput = {value: string; command: string};
export type CommandLineActionEntry = Omit<ActionEntry, 'action'> & {
	action?: (
		...args: [NavigateCtx, CommandLineActionEntry, CommandLineInput]
	) => void | Promise<void>;
};
