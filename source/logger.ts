import fs from 'fs';
import path from 'path';
import util from 'util';
import {isFail} from './lib/model/result-types.js';
import {EPIQ_DIR_NAME, resolveClosestEpiqRoot} from './lib/storage/paths.js';
import {LogLevel} from './lib/state/settings.state.js';

export const MAX_LINES = 500;
// One message may span many lines (a stack trace does), so the file is bounded
// in bytes as well: a log past V8's string cap cannot be read back to trim it,
// and a trim that throws inside the logger takes the whole app down with it.
export const MAX_BYTES = 4 * 1024 * 1024;
// Caps a single message, so one dump of a large object or a deep stack cannot
// eat the whole horizon on its own.
export const MAX_MESSAGE_CHARS = 16 * 1024;
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

// The last `maxBytes` of the file, starting at a line boundary, without
// decoding what comes before them.
const readTail = (filePath: string, maxBytes: number): string => {
	const size = fs.statSync(filePath).size;

	if (size <= maxBytes) {
		return fs.readFileSync(filePath, 'utf8');
	}

	const fd = fs.openSync(filePath, 'r');
	try {
		const buffer = Buffer.alloc(maxBytes);
		fs.readSync(fd, buffer, 0, maxBytes, size - maxBytes);
		const text = buffer.toString('utf8');
		const firstNewline = text.indexOf('\n');

		return firstNewline === -1 ? '' : text.slice(firstNewline + 1);
	} finally {
		fs.closeSync(fd);
	}
};

export function enforceLogHorizon(logPath: string) {
	if (!fs.existsSync(logPath)) return;

	const size = fs.statSync(logPath).size;
	const lines = readTail(logPath, MAX_BYTES).split('\n');

	if (lines[lines.length - 1] === '') {
		lines.pop();
	}

	if (size <= MAX_BYTES && lines.length <= MAX_LINES) return;

	const trimmed = lines.slice(-MAX_LINES).join('\n') + '\n';

	fs.writeFileSync(logPath, trimmed, 'utf8');
}

const clip = (message: string): string => {
	if (message.length <= MAX_MESSAGE_CHARS) return message;

	const dropped = message.length - MAX_MESSAGE_CHARS;

	return `${message.slice(0, MAX_MESSAGE_CHARS)} … [${dropped} more chars]`;
};

function write(prefix: string, args: unknown[], short = false) {
	const logPath = getLogPath();
	if (!logPath) return;

	const message = clip(util.format(...args));
	const now = new Date();

	const timestamp = short ? now.toISOString().slice(11, 19) : now.toISOString();

	const line = `[${timestamp}] ${prefix} ${message}\n`;

	// A log that cannot be written or trimmed is not a reason to take the app
	// down: the callers are already on an error path or in a render.
	try {
		fs.mkdirSync(path.dirname(logPath), {recursive: true});
		fs.appendFileSync(logPath, line, 'utf8');

		writesSinceTrim++;

		// The byte cap is checked on every write, not every fiftieth: a log
		// inherited from an older build may already be far past it.
		if (
			writesSinceTrim >= TRIM_EVERY_N_WRITES ||
			fs.statSync(logPath).size > MAX_BYTES
		) {
			writesSinceTrim = 0;
			enforceLogHorizon(logPath);
		}
	} catch {
		// Dropped on purpose.
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
