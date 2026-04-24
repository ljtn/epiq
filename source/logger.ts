import fs from 'fs';
import path from 'path';
import util from 'util';
import {resolveEpiqRoot} from './event/event-persist.js';
import {getEpiqDirName, isTesting} from './init.js';

const MAX_LINES = 1000;

const getLogPath = (rootDir = process.cwd()) =>
	path.join(resolveEpiqRoot(rootDir), getEpiqDirName(), 'log', 'epiq.log');

function enforceLogHorizon(rootDir = process.cwd()) {
	if (!isTesting) return;

	const logPath = getLogPath(rootDir);
	if (!fs.existsSync(logPath)) return;

	const content = fs.readFileSync(logPath, 'utf8');
	const lines = content.split('\n');

	if (lines[lines.length - 1] === '') {
		lines.pop();
	}

	if (lines.length <= MAX_LINES) return;

	const trimmed = lines.slice(-MAX_LINES).join('\n') + '\n';
	fs.writeFileSync(logPath, trimmed, 'utf8');
}

function write(
	prefix: string,
	args: unknown[],
	short = false,
	rootDir = process.cwd(),
) {
	if (!isTesting) return;

	const logPath = getLogPath(rootDir);
	const message = util.format(...args);

	const now = new Date();
	const timestamp = short ? now.toISOString().slice(11, 19) : now.toISOString();

	const line = `[${timestamp}] ${prefix} ${message}\n`;

	fs.mkdirSync(path.dirname(logPath), {recursive: true});
	fs.appendFileSync(logPath, line, 'utf8');
	enforceLogHorizon(rootDir);
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
