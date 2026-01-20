import fs from 'fs';
import path from 'path';
import util from 'util';

const DEFAULT_PATH = path.resolve(process.cwd(), 'debug.log');

export function bug(...args: any[]) {
	const timestamp = new Date().toISOString();
	const message = util.format(...args);
	const line = `[${timestamp}] ${message}\n`;

	// Ensure parent directory exists
	fs.mkdirSync(path.dirname(DEFAULT_PATH), {recursive: true});

	// appendFileSync creates the file if it does not exist
	fs.appendFileSync(DEFAULT_PATH, line, 'utf8');
}
