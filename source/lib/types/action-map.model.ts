export type Mode = 'default' | 'move';
export type ActionEntry<TArgs extends any[] = []> = {
	key: string; // physical key (readline `key.name`)
	mode: string;
	description?: string;
	action: (...args: TArgs) => void; // receives whatever we decide to pass
};

export type ActionMap<T extends Record<string, any[]>> = {
	[K in keyof T]: ActionEntry<T[K]>[];
};
