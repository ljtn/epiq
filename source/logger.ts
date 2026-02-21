import fs from 'fs';
import path from 'path';
import util from 'util';

const DEBUG_PATH = path.resolve(process.cwd(), '.epiq', 'log', 'debug.log');
const ERROR_PATH = path.resolve(process.cwd(), '.epiq', 'log', 'error.log');

export const logger = {
	debug(...args: any[]) {
		// const timestamp = new Date().toISOString();
		const message = util.format(...args);
		// const line = `[${timestamp}] ${message}\n`;
		const line = `${message}\n`;

		// Ensure parent directory exists
		fs.mkdirSync(path.dirname(DEBUG_PATH), {recursive: true});

		// appendFileSync creates the file if it does not exist
		fs.appendFileSync(DEBUG_PATH, line, 'utf8');
	},
	error(...args: any[]) {
		// const timestamp = new Date().toISOString();
		const message = util.format(...args);
		// const line = `[${timestamp}] ${message}\n`;
		const line = `${message}\n`;

		// Ensure parent directory exists
		fs.mkdirSync(path.dirname(ERROR_PATH), {recursive: true});

		// appendFileSync creates the file if it does not exist
		fs.appendFileSync(ERROR_PATH, line, 'utf8');
	},
};

// make it global
(globalThis as any).logger = logger;

export {};
