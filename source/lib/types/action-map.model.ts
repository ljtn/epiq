import readline from 'readline';
import {NavigateCtx} from '../navigation-context.js';
export const Mode = {
	DEFAULT: 'default',
	MOVE: 'move',
} as const;

export type ModeOptions = (typeof Mode)[keyof typeof Mode];

export type ActionEntry<TArgs extends any[] = []> = {
	mapKey:
		| ((key: readline.Key, ctx: NavigateCtx) => {isMatch: boolean})
		| string;
	mode: string;
	description?: string;
	hideInHelp?: true;
	action: (...args: TArgs) => void; // receives whatever we decide to pass
};

export type ActionMap<T extends Record<string, any[]>> = {
	[K in keyof T]: ActionEntry<T[K]>[];
};
