export const Mode = {
	DEFAULT: 'default',
	MOVE: 'move',
} as const;

export type ModeOptions = (typeof Mode)[keyof typeof Mode];

export type ActionEntry<TArgs extends any[] = []> = {
	intent: string;
	mode: string;
	description?: `[${string}] ${string}`;
	hideInHelpMenu?: true;
	action?: (...args: TArgs) => void; // receives whatever we decide to pass
};

export type ActionMap<T extends Record<string, any[]>> = {
	[K in keyof T]: ActionEntry<T[K]>[];
};
