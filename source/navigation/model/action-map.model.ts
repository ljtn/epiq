import {NavigateUtils} from '../actions/default/navigation-action-utils.js';
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
	mode: ModeUnion;
	description?: `[${string}] ${string}`;
	action?: (
		...args: [NavigateUtils, ActionEntry, readline.Key]
	) => void | Promise<void>;
};

export type ActionMap<T extends Record<string, any[]>> = {
	[K in keyof T]: ActionEntry[];
};

type CommandLineInput = {value: string; command: string};
export type CommandLineActionEntry = Omit<ActionEntry, 'action'> & {
	action?: (
		...args: [NavigateUtils, CommandLineActionEntry, CommandLineInput]
	) => void | Promise<void>;
};
