import fs from 'fs';
import path from 'path';
import util from 'util';
import {resolveClosestEpiqRoot} from './lib/storage/paths.js';
import {EPIQ_DIR_NAME, isLocal} from './lib/storage/paths.js';
import {isFail} from './lib/model/result-types.js';

const MAX_LINES = 1000;

const getLogPath = () => {
	const cwd = process.cwd();
	const epiqRootDirResult = resolveClosestEpiqRoot(cwd);
	if (isFail(epiqRootDirResult)) return undefined;
	return path.join(epiqRootDirResult.value, EPIQ_DIR_NAME, 'log', 'epiq.log');
};

function enforceLogHorizon() {
	if (!isLocal) return;

	const logPathResult = getLogPath();

	if (logPathResult === undefined) return;
	if (!fs.existsSync(logPathResult)) return;

	const content = fs.readFileSync(logPathResult, 'utf8');
	const lines = content.split('\n');

	if (lines[lines.length - 1] === '') {
		lines.pop();
	}

	if (lines.length <= MAX_LINES) return;

	const trimmed = lines.slice(-MAX_LINES).join('\n') + '\n';
	fs.writeFileSync(logPathResult, trimmed, 'utf8');
}

function write(prefix: string, args: unknown[], short = false) {
	if (!isLocal) return;

	const logPath = getLogPath();
	if (!logPath) return;

	const message = util.format(...args);

	const now = new Date();
	const timestamp = short ? now.toISOString().slice(11, 19) : now.toISOString();

	const line = `[${timestamp}] ${prefix} ${message}\n`;

	fs.mkdirSync(path.dirname(logPath), {recursive: true});
	fs.appendFileSync(logPath, line, 'utf8');
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
