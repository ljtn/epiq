export {};

declare global {
	const logger: {
		info(...args: unknown[]): void;
		debug(...args: unknown[]): void;
		error(...args: unknown[]): void;
	};
}
