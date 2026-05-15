import fs from 'fs';
import path from 'path';
import util from 'util';
import {isFail} from './lib/model/result-types.js';
import {EPIQ_DIR_NAME, resolveClosestEpiqRoot} from './lib/storage/paths.js';
import {LogLevel} from './lib/state/settings.state.js';

const MAX_LINES = 1000;
const TRIM_EVERY_N_WRITES = 50;

let writesSinceTrim = 0;

const isMcp = () => process.env['EPIQ_MCP'] === 'true';

const getLogPath = () => {
	const cwd = process.cwd();
	const epiqRootDirResult = resolveClosestEpiqRoot(cwd);

	if (isFail(epiqRootDirResult)) {
		if (isMcp()) {
			return path.join(process.cwd(), '.epiq-mcp.log');
		}

		return undefined;
	}

	return path.join(epiqRootDirResult.value, EPIQ_DIR_NAME, 'log', 'epiq.log');
};

function enforceLogHorizon() {
	const logPath = getLogPath();

	if (!logPath) return;
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

function write(prefix: string, args: unknown[], short = false) {
	const logPath = getLogPath();
	if (!logPath) return;

	const message = util.format(...args);
	const now = new Date();

	const timestamp = short ? now.toISOString().slice(11, 19) : now.toISOString();

	const line = `[${timestamp}] ${prefix} ${message}\n`;

	fs.mkdirSync(path.dirname(logPath), {recursive: true});
	fs.appendFileSync(logPath, line, 'utf8');

	writesSinceTrim++;

	if (writesSinceTrim >= TRIM_EVERY_N_WRITES) {
		writesSinceTrim = 0;
		enforceLogHorizon();
	}
}

const getLogLevel = (): LogLevel => {
	if (isMcp()) {
		return (process.env['EPIQ_MCP_LOG_LEVEL'] as LogLevel) ?? 'error';
	}

	return (process.env['EPIQ_LOG_LEVEL'] as LogLevel) ?? 'debug';
};

export const logger = {
	info(...args: unknown[]): void {
		const level = getLogLevel();

		if (level === 'info' || level === 'debug') {
			write('[Info]', args, false);
		}
	},

	debug(...args: unknown[]): void {
		const level = getLogLevel();

		if (level === 'debug') {
			write('[Debug]', args, true);
		}
	},

	error(...args: unknown[]): void {
		const level = getLogLevel();

		if (level === 'error' || level === 'info' || level === 'debug') {
			const hasError = args.some(arg => arg instanceof Error);
			const stack = hasError ? undefined : new Error().stack;

			write('[Error]', [...args, stack].filter(Boolean), false);
		}
	},
};

(globalThis as {logger?: typeof logger}).logger = logger;

export {};
