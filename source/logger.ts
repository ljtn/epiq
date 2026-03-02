import fs from 'fs';
import path from 'path';
import util from 'util';

const LOG_PATH = path.resolve(process.cwd(), '.epiq', 'log', 'app.log');

function write(prefix: string, args: any[]) {
	const message = util.format(...args);
	const timestamp = new Date().toISOString();
	const line = `[${timestamp}] ${prefix} ${message}\n`;

	// Ensure parent directory exists
	fs.mkdirSync(path.dirname(LOG_PATH), {recursive: true});

	// appendFileSync creates the file if it does not exist
	fs.appendFileSync(LOG_PATH, line, 'utf8');
}

export const logger = {
	debug(...args: any[]) {
		write('[DEBUG]', args);
	},
	error(...args: any[]) {
		write('[ERROR]', [...args, new Error().stack]);
	},
};

// make it global
(globalThis as any).logger = logger;

export {};
