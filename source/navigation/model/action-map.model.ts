import {NavigateCtx} from './navigation-ctx.model.js';

export const Mode = {
	DEFAULT: 'default',
	MOVE: 'move',
	HELP: 'help',
} as const;
export type ModeUnion = (typeof Mode)[keyof typeof Mode];

export type ActionEntry<R extends any[] = []> = {
	intent?: string;
	mode: ModeUnion;
	description?: `[${string}] ${string}`;
	action?: (...args: R) => void; // receives whatever we decide to pass
};
export type ActionEntryRecursive = ActionEntry<
	[NavigateCtx, ActionEntryRecursive]
>;

export type ActionMap<T extends Record<string, any[]>> = {
	[K in keyof T]: ActionEntryRecursive[];
};
