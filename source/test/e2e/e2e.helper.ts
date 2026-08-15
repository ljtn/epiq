import {Terminal} from '@xterm/headless';
import pty from 'node-pty';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// These files run one at a time (`--no-file-parallelism`). Each drives a real
// TUI through a pty and shells out to git, so parallelism only adds contention.
const width = 120;
const height = 20;

export const ENTER = '\r';
export const ARROW_DOWN = '\x1B\x5B\x42';
export const ARROW_UP = '\x1B\x5B\x41';
export const ARROW_RIGHT = '\x1B\x5B\x43';
export const ARROW_LEFT = '\x1B\x5B\x44';

const MOVE_CURSOR_HOME = '\x1B[H';
const CLEAR_SCREEN = '\x1B[2J';
const HIDE_CURSOR = '\x1B[?25l';
const SHOW_CURSOR = '\x1B[?25h';

let lastLoggedOutput = '';

const logFrame = (output: string) => {
	if (output === lastLoggedOutput) return;

	lastLoggedOutput = output;

	process.stdout.write(
		HIDE_CURSOR + MOVE_CURSOR_HOME + CLEAR_SCREEN + output + SHOW_CURSOR,
	);
};

type TuiSession = {
	cwd: string;
	input: (...values: string[]) => void;
	output: () => string;
	waitFor: (
		text: string | RegExp | ((output: string) => boolean),
		timeoutMs?: number,
	) => Promise<string>;
	clear: () => void;
	destroy: () => void;
};

// Per-file isolation, so concurrent files never share a global config dir.
// HOME is deliberately left alone: git still needs the real ~/.gitconfig.
const isolatedGlobalDir = fs.mkdtempSync(
	path.join(os.tmpdir(), 'epiq-e2e-global-'),
);

// On the worker's own env too, so in-process API calls see the same dir.
process.env['EPIQ_GLOBAL_DIR'] = isolatedGlobalDir;

const createTuiEnv = (extra: Record<string, string> = {}) => {
	const env = {...process.env};

	delete env['CI'];
	delete env['GITHUB_ACTIONS'];

	return {
		...env,
		TERM: 'xterm-256color',
		FORCE_COLOR: '1',
		...extra,
	};
};

const sleep = async (ms: number) =>
	await new Promise(resolve => setTimeout(resolve, ms));

// Text inside the command-line box, which is the last bordered row of a frame.
const commandLineContent = (frame: string): string => {
	const lines = frame.split('\n');

	for (let index = lines.length - 1; index >= 0; index--) {
		const match = /^│(.*)│$/.exec((lines[index] ?? '').trim());
		if (match) return (match[1] ?? '').trim();
	}

	return '';
};

/**
 * True when the command line holds no typed command. Not "contains the
 * placeholder": the caption is absent in some contexts, so waiting on it hangs.
 */
export const commandLineIsIdle = (frame: string): boolean => {
	const content = commandLineContent(frame);
	return content === '' || content === ': for command line';
};

const describeWaitTarget = (
	text: string | RegExp | ((output: string) => boolean),
): string => {
	if (typeof text === 'string') return JSON.stringify(text);
	if (text instanceof RegExp) return String(text);
	return 'a predicate';
};

type SetupTuiOptions = {
	/** Left in place on `destroy()` so a later session can replay the log. */
	cwd?: string;
	/** Extra environment variables for the spawned process (e.g. EDITOR). */
	env?: Record<string, string>;
};

export const setupTui = (
	args: string[] = [],
	options: SetupTuiOptions = {},
): TuiSession => {
	const ownsCwd = options.cwd === undefined;
	const cwd =
		options.cwd ?? fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-e2e-'));
	const cliPath = path.resolve(process.cwd(), 'dist/index.js');

	let destroyed = false;
	let renderedOutput = '';
	let pendingWrites: Promise<void> = Promise.resolve();
	let lastDataAt = Date.now();

	const terminal = new Terminal({
		cols: width,
		rows: height,
		allowProposedApi: true,
	});

	const child = pty.spawn(process.execPath, [cliPath, ...args], {
		name: 'xterm-256color',
		cols: width,
		rows: height,
		cwd,
		env: createTuiEnv(options.env),
	});

	const renderOutput = () => {
		const lines: string[] = [];

		for (let i = 0; i < height; i++) {
			lines.push(
				terminal.buffer.active.getLine(i)?.translateToString(true) ?? '',
			);
		}

		renderedOutput = lines
			.map(line => line.padEnd(width, ' ').slice(0, width))
			.join('\n');

		logFrame(renderedOutput);
	};

	const flushOutput = async () => {
		await pendingWrites;
		renderOutput();
	};

	child.onData(data => {
		lastDataAt = Date.now();
		pendingWrites = pendingWrites.then(
			() =>
				new Promise<void>(resolve => {
					terminal.write(data, () => {
						renderOutput();
						resolve();
					});
				}),
		);
	});

	// One frame arrives as several PTY chunks, so a predicate can match a
	// half-drawn screen. Waiting for the stream to fall quiet returns only
	// complete frames; bounded because the animated sync indicator never stops.
	const SETTLE_QUIET_MS = 30;
	const MAX_SETTLE_WAIT_MS = 300;

	const settle = async () => {
		const settleDeadline = Date.now() + MAX_SETTLE_WAIT_MS;

		while (
			Date.now() - lastDataAt < SETTLE_QUIET_MS &&
			Date.now() < settleDeadline
		) {
			await sleep(5);
		}

		await flushOutput();
	};

	const getOutput = () => renderedOutput;

	const clearOutput = () => {
		terminal.reset();
		renderOutput();
	};

	const destroy = () => {
		if (destroyed) return;
		destroyed = true;

		try {
			child.write('\x03');
			child.kill();
		} catch {
			// noop
		}

		if (ownsCwd) {
			fs.rmSync(cwd, {recursive: true, force: true});
		}
	};

	return {
		cwd,

		input: (...values) => {
			for (const item of values) {
				child.write(item);
			}
		},

		output: getOutput,
		clear: clearOutput,

		waitFor: async (text, timeoutMs = 3_000) => {
			const startedAt = Date.now();
			const matches = (output: string) =>
				typeof text === 'string'
					? output.includes(text)
					: text instanceof RegExp
					? text.test(output)
					: text(output);

			while (Date.now() - startedAt < timeoutMs) {
				await flushOutput();

				if (matches(getOutput())) {
					await settle();

					// Re-checked after settling: the frame that matched may have been
					// a partial one, and the completed frame is the truthful answer
					// either way.
					if (matches(getOutput())) return getOutput();
				}

				await sleep(1);
			}

			await flushOutput();

			// Throws rather than returning the last frame. Returning it made every
			// timeout surface as whatever assertion the caller ran next — "expected
			// '   …' to contain 'This folder is not…'" — which reads like a content
			// bug in the app instead of a wait that never came true.
			throw new Error(
				`Timed out after ${timeoutMs}ms waiting for ${describeWaitTarget(
					text,
				)}.\nLast rendered frame:\n${getOutput()}`,
			);
		},

		destroy,
	};
};
