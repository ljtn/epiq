import fs from 'fs';
import path from 'path';
import util from 'util';

const LOG_PATH = path.resolve(process.cwd(), '.epiq', 'log', 'app.log');
const MAX_LINES = 1000;

function enforceLogHorizon() {
	if (!fs.existsSync(LOG_PATH)) return;

	const content = fs.readFileSync(LOG_PATH, 'utf8');
	const lines = content.split('\n');

	// Remove possible trailing empty line from split
	if (lines[lines.length - 1] === '') {
		lines.pop();
	}

	if (lines.length <= MAX_LINES) return;

	const trimmed = lines.slice(-MAX_LINES).join('\n') + '\n';
	fs.writeFileSync(LOG_PATH, trimmed, 'utf8');
}
function write(prefix: string, args: any[], short = false) {
	const message = util.format(...args);

	const now = new Date();
	const timestamp = short
		? now.toISOString().slice(11, 19) // HH:mm:ss
		: now.toISOString(); // full ISO

	const line = `[${timestamp}] ${prefix} ${message}\n`;

	// Ensure parent directory exists
	fs.mkdirSync(path.dirname(LOG_PATH), {recursive: true});

	// Append new line
	fs.appendFileSync(LOG_PATH, line, 'utf8');

	// Enforce 1000 line horizon
	enforceLogHorizon();
}

export const logger = {
	info(...args: any[]): void {
		write('[INFO]', args, false);
	},
	debug(...args: any[]): void {
		write('[DEBUG]', args, true); // 👈 short timestamp
	},
	error(...args: any[]): void {
		write('[ERROR]', [...args, new Error().stack], false);
	},
};

// make it global
(globalThis as any).logger = logger;

export {};
