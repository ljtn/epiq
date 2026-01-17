import {NavigateCtx} from './navigation-ctx.model.js';

export const Mode = {
	DEFAULT: 'default',
	MOVE: 'move',
	HELP: 'help',
} as const;
export type ModeUnion = (typeof Mode)[keyof typeof Mode];

export type ActionEntry = {
	intent?: string;
	mode: ModeUnion;
	description?: `[${string}] ${string}`;
	action?: (...args: [NavigateCtx, ActionEntry]) => void; // receives whatever we decide to pass
};

export type ActionMap<T extends Record<string, any[]>> = {
	[K in keyof T]: ActionEntry[];
};
