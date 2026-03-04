export {};

declare global {
	const logger: {
		info(...args: any[]): void;
		debug(...args: any[]): void;
		error(...args: any[]): void;
	};
}
