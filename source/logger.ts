import fs from 'fs';
import path from 'path';
import util from 'util';

const isLocal = process.env['IS_LOCAL'] === 'true';
const LOG_PATH = path.resolve(process.cwd(), '.epiq', 'log', 'app.log');
const MAX_LINES = 1000;

function enforceLogHorizon() {
	if (!isLocal || !fs.existsSync(LOG_PATH)) return;

	const content = fs.readFileSync(LOG_PATH, 'utf8');
	const lines = content.split('\n');

	if (lines[lines.length - 1] === '') {
		lines.pop();
	}

	if (lines.length <= MAX_LINES) return;

	const trimmed = lines.slice(-MAX_LINES).join('\n') + '\n';
	fs.writeFileSync(LOG_PATH, trimmed, 'utf8');
}

function write(prefix: string, args: unknown[], short = false) {
	if (!isLocal) return;

	const message = util.format(...args);

	const now = new Date();
	const timestamp = short ? now.toISOString().slice(11, 19) : now.toISOString();

	const line = `[${timestamp}] ${prefix} ${message}\n`;

	fs.mkdirSync(path.dirname(LOG_PATH), {recursive: true});
	fs.appendFileSync(LOG_PATH, line, 'utf8');
	enforceLogHorizon();
}

export const logger = {
	info(...args: unknown[]): void {
		write('[Info]', args, false);
	},
	debug(...args: unknown[]): void {
		write('->', args, true);
	},
	error(...args: unknown[]): void {
		write('[Error]', [...args, new Error().stack], false);
	},
};

(globalThis as {logger?: typeof logger}).logger = logger;

export {};
